import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ShowAllPage } from '../../search'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>
}): Promise<Metadata> {
  const { name } = await params
  return { title: `Search ${decodeURIComponent(name)} | Typesense` }
}

// The client page reads the query with useSearchParams, which needs a Suspense
// boundary, or `next build` refuses to prerender.
export default function CollectionRoute() {
  return (
    <Suspense>
      <ShowAllPage />
    </Suspense>
  )
}
