import { Form, json, useActionData, useNavigation } from '@remix-run/react'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY })
const numberOfImagesToGenerate = 7

const generateImage = async () => {
	try {
		const response = await openai.images
			.generate({
				model: 'dall-e-3',
				prompt: 'A sunlit indoor lounge area with a pool containing a flamingo',
				n: 1,
				size: '1024x1024',
			})
			.asResponse()
		const json = await response.json()
		return {
			url: (json as { data: Array<{ url: string }> }).data[0]?.url,
			resetTime: response.headers.get('x-ratelimit-reset-images') ?? '0',
			remainingRequests: parseInt(
				response.headers.get('x-ratelimit-remaining-images') ?? '0',
				10,
			),
		}
	} catch (error) {
		const err = error as any
		if ('status' in err && err.status === 429) {
			const retryAfter = err.headers['x-ratelimit-reset-images'] || '60'
			const waitTime = parseInt(retryAfter, 10) * 1000
			await new Promise((resolve) => setTimeout(resolve, waitTime))
			return generateImage()
		}
		throw error
	}
}

export async function action() {
	const imageUrls: string[] = []
	let resetTime = 0
	let remainingRequests = 0

	const generateImages = async () => {
		let attempts = 0
		const generatePromises = []

		while (
			imageUrls.length < numberOfImagesToGenerate &&
			attempts < numberOfImagesToGenerate * 3
		) {
			if (remainingRequests <= 0) {
				const waitTime = Math.max(0, resetTime - Date.now())
				await new Promise((resolve) => setTimeout(resolve, waitTime))
			}

			generatePromises.push(async () => {
				try {
					const {
						url,
						resetTime: newResetTime,
						remainingRequests: newRemainingRequests,
					} = await generateImage()
					if (url) imageUrls.push(url)
					resetTime = Date.now() + parseInt(newResetTime, 10) * 1000
					remainingRequests = newRemainingRequests
				} catch (error) {
					console.error('Failed to generate image:', error)
				}

				attempts++
			})
		}
	}

	await generateImages()

	return json({ imageUrls })
}

export default function Testing() {
	const data = useActionData<typeof action>()
	const imageUrls = data?.imageUrls ?? []
	const navigation = useNavigation()

	return (
		<Form method="post">
			<button type="submit" disabled={navigation.state !== 'idle'}>
				Generate images
			</button>

			<div>
				{imageUrls.map((url) => (
					<img key={url} src={url} />
				))}
			</div>
		</Form>
	)
}
