# Catalog Search Implementation Notes

**Context**: Xing Anime project - client-side vs server-side search decision

## Key Learning

When implementing client-side search/filter for small catalogs (< 200 items):

1. **Always use `limit=1000`** (not default 100) when loading catalog data
2. Using `limit=100` causes items beyond page 1 to be invisible to filters
3. Client-side filter is preferable for small catalogs: zero latency, no extra API calls
4. Switch to server-side search when catalog exceeds ~200 items

## Working Pattern

```typescript
// catalog-client.tsx
useEffect(() => {
  fetch('/api/v1/catalog?limit=1000')  // ← CRITICAL: Load ALL items
    .then(r => r.json())
    .then(data => setAllItems(data.items));
}, []);

const filtered = useMemo(() => {
  return allItems.filter(item =>
    item.title.toLowerCase().includes(query.toLowerCase())
  );
}, [allItems, query]);
```

## API Search Endpoints

- `GET /api/v1/catalog?q=dragon` - Server-side search
- `GET /api/v1/catalog?limit=1000` - Full catalog load

Both work correctly. The issue was frontend only loading 100 items.

## Stats (2026-09-05)

```
Total anime in DB: 221
Verified sources: 129
Catalog items: 126
Discovered (awaiting hydration): 87
```
