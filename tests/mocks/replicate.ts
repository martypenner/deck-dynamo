import { http, passthrough, type HttpHandler } from 'msw'

export const handlers: Array<HttpHandler> = [
	http.get(`https://api.replicate.com/v1/predictions/*`, async () => {
		return passthrough()
	}),
	http.post(`https://api.replicate.com/v1/models/*/predictions`, async () => {
		return passthrough()
	}),
	http.get(`https://replicate.delivery/*`, async () => {
		return passthrough()
	}),
]
