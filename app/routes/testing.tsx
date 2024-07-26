import OpenAI from 'openai'

const openai = new OpenAI()

export async function loader() {
	const response = await openai.images.generate({
		model: 'dall-e-3',
		prompt: 'A sunlit indoor lounge area with a pool containing a flamingo',
		n: 1,
		size: '1024x1024',
	})
	const imageUrl = response.data[0]?.url
	console.log(response, imageUrl)

	return { hi: 'bye' }
}

export default function Testing() {
	return <div>Testing</div>
}
