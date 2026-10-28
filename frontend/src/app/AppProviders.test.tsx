import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AppProviders } from './AppProviders'

function Probe({ expected }: { expected?: QueryClient }) {
  const client = useQueryClient()
  return <p>{expected ? String(client === expected) : 'default'}</p>
}

it('provides the given query client and renders children', () => {
  const client = new QueryClient()
  render(
    <AppProviders client={client}>
      <Probe expected={client} />
    </AppProviders>,
  )
  expect(screen.getByText('true')).toBeInTheDocument()
})

it('falls back to the default client', () => {
  render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  )
  expect(screen.getByText('default')).toBeInTheDocument()
})
