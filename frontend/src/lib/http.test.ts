import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from './http'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('request', () => {
  it('prefixes /api and merges headers', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([1])))
    await expect(
      request('/todos', { headers: { 'X-Test': '1' } }),
    ).resolves.toEqual([1])
    expect(fetchMock).toHaveBeenCalledWith('/api/todos', {
      headers: { 'Content-Type': 'application/json', 'X-Test': '1' },
    })
  })

  it('works without init', async () => {
    fetchMock.mockResolvedValue(new Response('{}'))
    await expect(request('/x')).resolves.toEqual({})
  })

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(request('/todos/1')).resolves.toBeUndefined()
  })

  it('returns the fixed message for 422', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'x' }), { status: 422 }),
    )
    await expect(request('/todos')).rejects.toThrow(/Check the task details/)
  })

  it('uses a string detail', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Not found' }), { status: 404 }),
    )
    await expect(request('/todos')).rejects.toThrow('Not found')
  })

  it('falls back for non-string detail', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: [1] }), { status: 500 }),
    )
    await expect(request('/todos')).rejects.toThrow(
      'The operation failed. Please try again.',
    )
  })

  it('falls back for a non-JSON error body', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }))
    await expect(request('/todos')).rejects.toThrow(
      'The operation failed. Please try again.',
    )
  })

  it('gives a friendly message on network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'))
    await expect(request('/todos')).rejects.toThrow(
      'Cannot connect to the server. Please try again.',
    )
  })

  it('rethrows the original error when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = new DOMException('Aborted', 'AbortError')
    fetchMock.mockRejectedValue(error)
    await expect(request('/todos', { signal: controller.signal })).rejects.toBe(
      error,
    )
  })
})
