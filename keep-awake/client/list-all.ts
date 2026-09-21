interface Page<T> {
  entries: T[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export async function collectAllPages<T>(
  first: Page<T>,
  fetchPage: (cursor: string) => Promise<Page<T>>,
): Promise<T[]> {
  const entries = [...first.entries];
  let pageInfo = first.pageInfo;
  while (pageInfo.hasMore && pageInfo.nextCursor !== null) {
    const next = await fetchPage(pageInfo.nextCursor);
    entries.push(...next.entries);
    pageInfo = next.pageInfo;
  }
  return entries;
}
