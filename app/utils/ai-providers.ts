import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

export const openai = new OpenAI({ apiKey: process.env.OPENAI_KEY })
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })
