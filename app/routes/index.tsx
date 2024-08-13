import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import {
	json,
	useActionData,
	useFetcher,
	useLoaderData,
} from '@remix-run/react'
import clsx from 'clsx'
import { useCallback, useEffect, useState, useRef } from 'react'
import Replicate from 'replicate'
import { Button } from '#app/components/ui/button'

type Slides = Array<{
	image: {
		description: string
	}
}>

type Presentation = {
	date: Date
	topic: string
	slides: string[]
}

async function generateImageStableDiffusionUltra({
	prompt,
}: {
	prompt: string
}): Promise<ArrayBuffer> {
	const endpoint = 'https://api.stability.ai/v2beta/stable-image/generate/ultra'

	const formData = new FormData()
	formData.append('prompt', prompt)

	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
			Accept: 'image/*',
			// 'Content-type': 'multipart/form-data',
		},
		body: formData,
	})

	if (!response.ok) {
		console.error(response)
		throw new Error(`HTTP error! status: ${response.status}`)
	}

	return await response.arrayBuffer()
}
async function generateImageReplicateBlackForestLabsFluxPro({
	prompt,
}: {
	prompt: string
}): Promise<ArrayBuffer> {
	const replicate = new Replicate({
		auth: process.env.REPLICATE_API_KEY,
	})
	const input = {
		steps: 50,
		prompt,
		guidance: 3,
		interval: 2.5,
		aspect_ratio: '1:1',
		safety_tolerance: 4,
	}

	console.time('generate image on replicate')
	const url = (await replicate.run('black-forest-labs/flux-pro', {
		input,
	})) as unknown as string
	console.timeEnd('generate image on replicate')

	console.time('fetch image from replicate')
	const response = await fetch(url, {
		method: 'GET',
	})
	console.timeEnd('fetch image from replicate')

	return await response.arrayBuffer()
}

async function storeGeneratedContent({
	topic,
	title,
	presenter,
	slides,
	images,
}: {
	topic: string
	title: { content: string }
	presenter: { name: string; title: string }
	slides: Slides
	images: ArrayBuffer[]
}) {
	const datetime = new Date().toISOString().replace(/:/g, '-')
	const kebabCaseTopic = topic.toLowerCase().replace(/\s+/g, '-')
	const logDir = path.join('public/logs', `${datetime}-${kebabCaseTopic}`)

	fs.mkdirSync(logDir, { recursive: true })
	fs.writeFileSync(path.join(logDir, 'topic.txt'), topic)

	const imageDir = path.join(logDir, 'images')
	fs.mkdirSync(imageDir, { recursive: true })

	const fetchAndSaveImage = async (imageData: ArrayBuffer, index: number) => {
		const buffer = Buffer.from(imageData)
		const imagePath = path.join(imageDir, `image_${index}.png`)
		await fs.promises.writeFile(imagePath, buffer)
		return imagePath
	}

	const imagePaths = await Promise.all(images.map(fetchAndSaveImage))
	const slidesWithImagePaths = slides.map((slide, index) => ({
		...slide,
		image: {
			...slide.image,
			path: imagePaths[index]?.replace(logDir + '/', ''),
		},
	}))

	fs.writeFileSync(
		path.join(logDir, 'slides.json'),
		JSON.stringify({ title, presenter, slides: slidesWithImagePaths }, null, 2),
	)
}

export async function loader() {
	return json({ presentations: getPresentations() })
}

function getRandomTopic(): string | undefined {
	const topicsPath = path.join(process.cwd(), 'topics.txt')
	let topics = fs
		.readFileSync(topicsPath, 'utf-8')
		.split('\n')
		.filter((line) => line.trim().length > 0)

	if (topics.length === 0) {
		return
	}

	const randomIndex = Math.floor(Math.random() * topics.length)
	const selectedTopic = topics[randomIndex]

	topics.splice(randomIndex, 1)
	fs.writeFileSync(topicsPath, topics.join('\n'))

	return selectedTopic
}

export async function action() {
	const images: ArrayBuffer[] = []
	const totalSlides = 10
	const totalTextSlides = 3

	const openingSlide = false
		? `Ensure the first slide has the title along with a made-up name and a description of that person's job title or career accomplishments.`
		: ``

	const topic = getRandomTopic()
	if (topic == null) {
		console.error('No topic available')
		return json({ images, error: 'No topic available' })
	}
	console.info('Topic:', topic)

	const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })

	const slideOutline = await anthropic.messages.create(
		{
			model: 'claude-3-5-sonnet-20240620',
			max_tokens: 8000,
			temperature: 0.8,
			messages: [
				{
					role: 'user',
					content: `
						You are an expert improvisational slide deck creator.
	          Generate the outline for a random slide deck.
						The slide deck should be pretty barebones to allow a presenter to improvise their way through.
						This slide deck will be used in improv competitions, so it should not be continuous in topic
						from slide to slide. Ensure that there are a few completely surprising left turns to keep things
						dynamic. The slides should not tell the whole story in order to leave room for the improviser to
						justify the slides contents.

	          The presentation topic is "${topic}".

	          Focus more heavily on images instead of text on the slides. Any text you generate should be
						overlaid onto images. Assume that the image URLs will be provided elsewhere, but describe them in
						the JSON format I describe below. Only up to ${totalTextSlides} slides should contain text (you
						will need to specify the text in the image prompts).
						${openingSlide}
						The last slide should contain the words "in conclusion" and a random image.
						Generate ${totalSlides} slides, including the slides I've already described.

						Try to avoid slides with cats, ducks, penguins, pineapple, or pizza.

						Output in JSON format using the following schema. Do NOT provide any context, prelude, or
						explanation; only give back the JSON.
						\`\`\`
	{
	  "$schema": "https://json-schema.org/draft/2020-12/schema",
	  "type": "object",
	  "properties": {
	    "title": {
	      "type": "object",
	      "properties": {
	        "content": { "type": "string" }
	      },
	      "required": ["content"]
	    },
	    "presenter": {
	      "type": "object",
	      "properties": {
	        "name": { "type": "string" },
	        "title": { "type": "string" }
	      },
	      "required": ["name", "title"]
	    },
	    "slides": {
	      "type": "array",
	      "items": {
	        "type": "object",
	        "properties": {
	          "image": {
	            "type": "object",
	            "properties": {
	              "description": { "type": "string" }
	            },
	            "required": ["description"]
	          }
	        },
	        "required": ["image"],
	        "unevaluatedProperties": false
	      },
	      "minItems": 1
	    }
	  },
	  "required": ["title", "presenter", "slides"]
	}
						\`\`\`
					`,
				},
			],
		},
		{
			headers: {
				'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
			},
		},
	)

	if (slideOutline.content[0]?.type !== 'text') {
		console.error('Expected text response: ', slideOutline.content)
		return { images, error: 'Expected text response' }
	}

	const slidesJson = JSON.parse(
		slideOutline.content[0]?.type === 'text'
			? (slideOutline.content[0].text ?? 'null')
			: 'null',
	) as {
		title: { content: string }
		presenter: { name: string; title: string }
		slides: Slides
	} | null
	if (slidesJson == null) {
		console.error('Expected JSON response: ', slideOutline.content)
		return { images, error: 'Expected JSON response' }
	}

	const generateImages = async () => {
		const generatePromises = []

		for (const [index, slide] of slidesJson.slides.entries()) {
			generatePromises.push(
				(async () => {
					console.info('Generating image from prompt:', slide.image.description)

					try {
						// const imageData = await generateImageStableDiffusionUltra({
						// 	prompt: slide.image.description,
						// })
						const imageData =
							await generateImageReplicateBlackForestLabsFluxPro({
								prompt: slide.image.description,
							})
						console.info('Generated image')
						images[index] = imageData
					} catch (error) {
						console.error('Failed to generate image:', error)
						throw error
					}
				})(),
			)
		}

		await Promise.all(generatePromises)
	}

	await generateImages()

	// Probably shouldn't await this so that the server can respond more quickly, but meh
	await storeGeneratedContent({
		topic,
		title: slidesJson.title,
		presenter: slidesJson.presenter,
		slides: slidesJson.slides,
		images,
	})

	return json({ images })
}

function getPresentations(): Presentation[] {
	const logDir = path.join(process.cwd(), 'public/logs')
	const logs = fs.readdirSync(logDir)

	const presentations = logs.map((generation) => {
		const generationPath = path.join(logDir, generation)
		const topicPath = path.join(generationPath, 'topic.txt')
		const topic = fs.readFileSync(topicPath, 'utf-8').trim()

		const [date] = generation.split('Z-')

		const slidesPath = path.join(generationPath, 'slides.json')
		const presentation = JSON.parse(fs.readFileSync(slidesPath, 'utf-8')) as {
			title: string
			presenter: { name: string; title: string }
			slides: {
				image: { path: string }
			}[]
		}

		const title = presentation.title
		const presenter = presentation.presenter

		return {
			date: new Date(date ?? ''),
			topic,
			title,
			presenter,
			slides: presentation.slides.map(
				(slide) => '/logs/' + generation + '/' + slide.image.path,
			),
		}
	})

	presentations.sort((a, b) => {
		if (a.date > b.date) return -1
		if (a.date < b.date) return 1
		return a.topic.localeCompare(b.topic)
	})

	return presentations
}

export default function GeneratePresentation() {
	const { presentations } = useLoaderData<typeof loader>()
	const data = useActionData<typeof action>()
	const images = data?.images ?? []

	const { Form, state } = useFetcher()
	const [selectedTopic, setSelectedTopic] = useState(
		images.length > 0 ? 'generated' : '',
	)
	const currentTopicSlides =
		presentations.find((presentation) => presentation.topic === selectedTopic)
			?.slides ?? images

	const selectRandomPresentation = useCallback(() => {
		const chosenPresentations = JSON.parse(
			localStorage.getItem('chosenPresentations') ?? '[]',
		) as string[]
		const availablePresentations = presentations.filter(
			(presentation) => !chosenPresentations.includes(presentation.topic),
		)

		if (availablePresentations.length > 0) {
			const randomIndex = Math.floor(
				Math.random() * availablePresentations.length,
			)
			const randomPresentation = availablePresentations[randomIndex]?.topic
			if (randomPresentation == null) return

			setSelectedTopic(randomPresentation)
			chosenPresentations.push(randomPresentation)
			localStorage.setItem(
				'chosenPresentations',
				JSON.stringify(chosenPresentations),
			)
		} else {
			alert('All presentations have been viewed. Resetting selection.')
			localStorage.setItem(
				'chosenPresentations',
				JSON.stringify(chosenPresentations),
			)
		}
	}, [presentations])

	return (
		<div className="container px-6 py-4">
			<div className="mb-4 flex items-center">
				<Form method="post">
					<Button
						variant="default"
						size="lg"
						type="submit"
						disabled={state !== 'idle'}
					>
						{state === 'idle' ? 'Generate a presentation' : 'Generating...'}
					</Button>
				</Form>

				<span className="mx-4 font-bold">OR</span>

				<Button
					variant="default"
					size="lg"
					type="button"
					onClick={selectRandomPresentation}
				>
					View a random presentation
				</Button>
			</div>

			<div className="mb-4 font-bold">OR</div>

			<label>
				<div className="font-semibold">View one</div>
				<select
					value={selectedTopic}
					onChange={(e) => setSelectedTopic(e.target.value)}
					className="mb-10 text-black"
				>
					<option value=""></option>
					{images.length > 0 && (
						<option value="generated">Generated presentation</option>
					)}
					{presentations.map((presentation) => (
						<option key={presentation.topic} value={presentation.topic}>
							{presentation.topic}
						</option>
					))}
				</select>
			</label>

			{selectedTopic.trim() !== '' && (
				<SlideNavigation
					key={selectedTopic}
					slides={currentTopicSlides as (string | ArrayBuffer)[]}
				/>
			)}
		</div>
	)
}

const SlideNavigation = ({
	slides,
}: {
	slides: Array<string | ArrayBuffer>
}) => {
	const [currentSlide, setCurrentSlide] = useState(0)
	const containerRef = useRef<HTMLDivElement>(null)
	const [isFullscreen, setIsFullScreen] = useState(false)
	const goToNextSlide = useCallback(() => {
		setCurrentSlide((prev) => Math.min(prev + 1, slides.length - 1))
	}, [slides.length])

	const goToPreviousSlide = useCallback(() => {
		setCurrentSlide((prev) => Math.max(0, prev - 1))
	}, [])

	const toggleFullscreen = useCallback(() => {
		if (!isFullscreen) {
			const doIt = async () => {
				await containerRef.current?.requestFullscreen()
				setIsFullScreen(true)
			}
			doIt().catch(console.error)
		} else {
			document.exitFullscreen().catch(console.error)
			setIsFullScreen(false)
		}
	}, [isFullscreen])

	useEffect(() => {
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (
				!(event.target instanceof HTMLElement) ||
				event.target.tagName.toLowerCase() !== 'body'
			)
				return

			switch (event.key) {
				case 'ArrowRight':
				case ' ':
					event.preventDefault()
					event.stopPropagation()
					goToNextSlide()
					break
				case 'ArrowLeft':
				case 'Backspace':
					event.preventDefault()
					event.stopPropagation()
					goToPreviousSlide()
					break
				case 'f':
					event.preventDefault()
					event.stopPropagation()
					toggleFullscreen()
					break
				default:
					break
			}
		}
		const handleFullscreenChange = () => {
			if (!document.fullscreenElement) {
				setIsFullScreen(false)
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		window.addEventListener('fullscreenchange', handleFullscreenChange)
		return () => {
			window.removeEventListener('keydown', handleKeyDown)
			window.removeEventListener('fullscreenchange', handleFullscreenChange)
		}
	}, [goToNextSlide, goToPreviousSlide, toggleFullscreen])

	const handleTouchStart = useCallback(
		(event: React.TouchEvent<HTMLImageElement>) => {
			const touchX = event.touches[0]?.clientX ?? 0
			const touchY = event.touches[0]?.clientY ?? 0
			const containerWidth = event.currentTarget.clientWidth
			const containerHeight = event.currentTarget.clientHeight

			// Upper right 10% of the screen
			if (touchX > containerWidth * 0.9 && touchY < containerHeight * 0.1) {
				if (isFullscreen) {
					document.exitFullscreen().catch(console.error)
					setIsFullScreen(false)
				}
			} else if (touchX < containerWidth / 2) {
				goToPreviousSlide()
			} else {
				goToNextSlide()
			}
		},
		[goToPreviousSlide, goToNextSlide, isFullscreen],
	)

	return (
		<div
			ref={containerRef}
			className="position-relative flex h-full w-full items-center justify-center"
		>
			<img
				src={
					typeof slides[currentSlide] === 'string'
						? (slides[currentSlide] as string)
						: arrayBufferToUrl(slides[currentSlide] as ArrayBuffer)
				}
				alt={`Slide ${currentSlide + 1}`}
				className={clsx(
					isFullscreen && 'h-full max-h-full w-full max-w-full',
					'object-contain',
				)}
				onTouchStart={handleTouchStart}
			/>

			<div
				className={`absolute ${isFullscreen ? 'bottom-2.5 right-2.5' : 'right-2.5 top-1/2 -translate-y-1/2 transform'} rounded bg-black bg-opacity-50 px-2.5 py-1.5 text-xs text-white`}
			>
				{currentSlide + 1} / {slides.length}
			</div>

			<Button
				onClick={toggleFullscreen}
				className={clsx(
					isFullscreen && 'hidden',
					'touch-device:block absolute bottom-[180px] left-2.5 rounded bg-black bg-opacity-50 px-2.5 py-1.5 text-xs text-white sm:hidden md:hidden lg:hidden xl:hidden 2xl:hidden',
				)}
			>
				{isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
			</Button>
		</div>
	)
}

const arrayBufferToUrl = (buffer: ArrayBuffer): string => {
	const blob = new Blob([buffer], { type: 'image/png' })
	return URL.createObjectURL(blob)
}
