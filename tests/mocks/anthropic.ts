import { http, passthrough, type HttpHandler } from 'msw'

export const handlers: Array<HttpHandler> = [
	http.post(`https://api.anthropic.com/v1/*`, async () => {
		return passthrough()
	}),
]
