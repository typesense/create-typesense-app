import type { Metadata } from 'next'
import config from '../typesense.config.json'
import { HomePage } from './search'

// A server component only so that it can set the window title; the search UI is a client component.
const [only] = config.collections

export const metadata: Metadata = {
  title:
    config.collections.length === 1 && only
      ? `Search ${only.name} | Typesense`
      : 'Search | Typesense',
  description: 'Typo-tolerant search with Typesense.',
}

export default function Home() {
  return <HomePage />
}
