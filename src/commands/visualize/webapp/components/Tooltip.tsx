/// <reference lib="dom" />

export interface TooltipData {
  path: string
  isLeaf: boolean
  loc?: number
  changes?: number
  score?: number
  indexed?: boolean
}

interface TooltipProps {
  data: TooltipData | null
  x: number
  y: number
}

export function Tooltip({ data, x, y }: TooltipProps) {
  if (!data) return <div className="tooltip" />

  return (
    <div className="tooltip visible" style={{ left: x + 12, top: y - 10 }}>
      <strong>{data.path}</strong>
      {data.isLeaf && (
        <>
          <br />
          LOC: {data.loc ?? "\u2014"}
          <br />
          Changes: {data.changes ?? 0}
          <br />
          Score: {(data.score ?? 0).toFixed(3)}
          {!data.indexed && (
            <>
              <br />
              <em>Not indexed</em>
            </>
          )}
        </>
      )}
    </div>
  )
}
