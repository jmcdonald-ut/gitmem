/// <reference lib="dom" />
import { forwardRef } from "react"

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
}

export const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(
  function Tooltip({ data }, ref) {
    return (
      <div ref={ref} className={`tooltip ${data ? "visible" : ""}`}>
        {data && (
          <>
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
          </>
        )}
      </div>
    )
  },
)
