import fs from 'node:fs'
import path from 'node:path'
import { Form, json, useActionData, useNavigation } from '@remix-run/react'
import { openai, anthropic } from '#app/utils/ai-providers'

type Slides = Array<
	| {
			title: {
				content: string
			}
			presenter: {
				name: string
				title: string
			}
	  }
	| {
			image: {
				description: string
			}
	  }
>

const generateImage = async ({ prompt }: { prompt: string }) => {
	try {
		const response = await openai.images
			.generate({
				model: 'dall-e-3',
				prompt,
				n: 1,
				size: '1024x1024',
			})
			.asResponse()
		const json = await response.json()
		return {
			url: (json as { data: Array<{ url: string }> }).data[0]?.url,
		}
	} catch (error) {
		const err = error as any
		if ('status' in err && err.status === 429) {
			console.error('Rate limited, waiting', error)
			const retryAfter = err.headers['x-ratelimit-reset-images'] || '60'
			const jitter = Math.random() * 1000
			const waitTime = parseInt(retryAfter, 10) * 1000 + jitter
			console.info('waitTime, retryAfter', waitTime, retryAfter)
			await new Promise((resolve) => setTimeout(resolve, waitTime))
			return await generateImage({ prompt })
		}
		throw error
	}
}

function logGeneratedContent({
	topic,
	slides,
	imageUrls,
}: {
	topic: string
	slides: Slides
	imageUrls: string[]
}) {
	const datetime = new Date().toISOString().replace(/:/g, '-')
	const kebabCaseTopic = topic.toLowerCase().replace(/\s+/g, '-')
	const logDir = path.join('logs', `${datetime}-${kebabCaseTopic}`)

	fs.mkdirSync(logDir, { recursive: true })
	fs.writeFileSync(path.join(logDir, 'topic.txt'), topic)

	const slidesWithUrls = slides.map((slide, index) => ({
		...slide,
		...('image' in slide && {
			image: {
				...slide.image,
				url: imageUrls[index],
			},
		}),
	}))

	fs.writeFileSync(
		path.join(logDir, 'slides.json'),
		JSON.stringify(slidesWithUrls, null, 2),
	)
}

export async function action() {
	const imageUrls: string[] = []
	const totalSlides = 10
	const totalTextSlides = 3

	const openingSlide = false
		? `Ensure the first slide has the title along with a made-up name and a description of that person's job title or career accomplishments.`
		: ``

	const topicResponse = await anthropic.messages.create(
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
					Tell me only the topic, not anything else.
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
	const topic =
		topicResponse.content[0]?.type === 'text'
			? topicResponse.content[0]?.text
			: null
	if (topic == null) {
		console.error('No topic')
		return json({ imageUrls, error: 'No topic' })
	}
	console.info('Topic:', topic)

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

					Output in JSON format using the following schema. Do NOT provide any context, prelude, or
					explanation; only give back the JSON.
					\`\`\`
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "slides": {
      "type": "array",
      "items": {
        "type": "object",
        "oneOf": [
          {
            "properties": {
              "title": {
                "type": "object",
                "properties": {
                  "content": { "type": "string" }
                },
                "required": ["content", "alignment"]
              },
              "presenter": {
                "type": "object",
                "properties": {
                  "name": { "type": "string" },
                  "title": { "type": "string" }
                },
                "required": ["name", "description"]
              }
            },
            "required": ["title", "presenter"],
            "unevaluatedProperties": false
          },
          {
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
          }
        ]
      },
      "minItems": 1
    }
  },
  "required": ["slides"]
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
		return { imageUrls, error: 'Expected text response' }
	}

	const slidesJson = JSON.parse(
		slideOutline.content[0]?.type === 'text'
			? (slideOutline.content[0].text ?? 'null')
			: 'null',
	) as { slides: Slides } | null
	if (slidesJson == null) {
		console.error('Expected JSON response: ', slideOutline.content)
		return { imageUrls, error: 'Expected JSON response' }
	}

	const generateImages = async () => {
		const generatePromises = []

		for (const [index, slide] of slidesJson.slides.entries()) {
			if ('title' in slide) continue

			generatePromises.push(
				(async () => {
					console.info('Generating image from prompt:', slide.image.description)

					try {
						const { url } = await generateImage({
							prompt: slide.image.description,
						})
						console.info('Generated image:', url)
						if (url) {
							imageUrls[index] = url
						} else {
							throw new Error('Failed to generate image: No URL returned')
						}
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
	console.info(imageUrls)

	logGeneratedContent({ topic, slides: slidesJson.slides, imageUrls })

	return json({ imageUrls })
}

export default function Testing() {
	const data = useActionData<typeof action>()
	const imageUrls = data?.imageUrls ?? []
	const navigation = useNavigation()

	return (
		<Form method="post">
			<button type="submit" disabled={navigation.state !== 'idle'}>
				{navigation.state === 'idle' ? 'Generate images' : 'Generating...'}
			</button>

			<div>
				{imageUrls.map((url) => (
					<img key={url} src={url} alt="Generated slide image" />
				))}
			</div>
		</Form>
	)
}
