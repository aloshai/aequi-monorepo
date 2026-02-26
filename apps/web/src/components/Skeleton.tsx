interface SkeletonProps {
  width?: string
  height?: string
  borderRadius?: string
  className?: string
}

export function Skeleton({ width = '100%', height = '1rem', borderRadius = '4px', className }: SkeletonProps) {
  return (
    <div
      className={`skeleton-pulse ${className ?? ''}`}
      style={{ width, height, borderRadius }}
    />
  )
}

export function QuoteSkeleton() {
  return (
    <div className="quote-details">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="quote-detail-row">
          <Skeleton width="80px" height="0.85rem" />
          <Skeleton width="140px" height="0.85rem" />
        </div>
      ))}
    </div>
  )
}

export function RouteVisualSkeleton() {
  return (
    <div className="route-visual" style={{ padding: '16px' }}>
      <Skeleton width="100%" height="48px" borderRadius="8px" />
    </div>
  )
}
