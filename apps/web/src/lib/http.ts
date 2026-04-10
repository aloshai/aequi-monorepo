import axios from 'axios'

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

export const http = axios.create({
  baseURL,
  timeout: 30000,
})

export const resolveApiErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as { message?: string; error?: string } | undefined
    const status = error.response?.status

    if (payload?.error === 'quote_expired' || status === 410) {
      return 'Quote expired — refresh quote to continue.'
    }

    if (payload?.error === 'quote_not_found') {
      return 'Quote not found — request a fresh quote.'
    }

    if (payload?.error === 'quote_mismatch') {
      return 'Quote mismatch — refresh quote with current inputs.'
    }

    if (payload?.message) {
      return payload.message
    }
    if (payload?.error) {
      return payload.error
    }
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'Unexpected error, please retry.'
}

export const resolveApiErrorPayload = (error: unknown): unknown => {
  if (axios.isAxiosError(error)) {
    return error.response?.data ?? { message: error.message }
  }
  if (error instanceof Error) {
    return { message: error.message }
  }
  return { message: 'Unknown error' }
}
