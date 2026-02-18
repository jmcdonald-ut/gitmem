import type { HierarchyResult } from "@commands/visualize/hierarchy"

export function generatePage(
  hierarchy: HierarchyResult,
  repoName: string,
): string {
  const dataJson = JSON.stringify(hierarchy)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(repoName)} — gitmem visualize</title>
<style>
:root {
  --bg: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --border: #30363d;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --text-dim: #484f58;
  --accent: #58a6ff;
  --red: #da3633;
  --green: #2ea043;
  --yellow: #d4a72c;
  --blue: #58a6ff;
  --gray: #8b949e;
  --purple: #bc8cff;
  --cyan: #39d3c5;
  --white: #f0f0f0;
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  overflow: hidden;
  height: 100vh;
}

.layout {
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: 2fr 1fr;
  height: 100vh;
  max-width: 1600px;
  margin: 0 auto;
}

.header {
  grid-column: 1 / -1;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 12px;
}

.header h1 {
  font-size: 16px;
  font-weight: 600;
}

.breadcrumb {
  color: var(--text-muted);
  font-size: 13px;
}

.breadcrumb span {
  cursor: pointer;
  color: var(--accent);
}

.breadcrumb span:hover { text-decoration: underline; }

.banner {
  background: var(--bg-tertiary);
  color: var(--yellow);
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 4px;
  margin-left: auto;
}

.viz-container {
  position: relative;
  overflow: hidden;
}

.viz-container svg {
  width: 100%;
  height: 100%;
  display: block;
}

.tooltip {
  position: absolute;
  pointer-events: none;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 10;
}

.tooltip.visible { opacity: 1; }

.details {
  border-left: 1px solid var(--border);
  padding: 16px 20px;
  overflow-y: auto;
}

.details h2 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text);
}

.details h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 16px 0 8px;
}

.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.stat-item {
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 8px 12px;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
}

.stat-label {
  font-size: 11px;
  color: var(--text-muted);
}

.list-item {
  padding: 4px 0;
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  border-bottom: 1px solid var(--bg-tertiary);
}

.list-item:last-child { border-bottom: none; }

.list-file {
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 70%;
}

.list-value {
  color: var(--text-muted);
  white-space: nowrap;
}

.class-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  margin: 4px 0 8px;
}

.class-bar div { min-width: 2px; }

.class-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
}

.class-legend span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.class-legend .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.trend-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}

.trend-up { color: var(--red); }
.trend-down { color: var(--green); }
.trend-stable { color: var(--text-muted); }

.loading {
  color: var(--text-muted);
  font-style: italic;
  padding: 20px 0;
}

@media (max-width: 768px) {
  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr 1fr;
  }
  .details { border-left: none; border-top: 1px solid var(--border); }
}
</style>
</head>
<body>
<div class="layout">
  <div class="header">
    <h1>${escapeHtml(repoName)}</h1>
    <div class="breadcrumb" id="breadcrumb"></div>
    ${hierarchy.unindexedCount > 0 ? `<div class="banner">${hierarchy.unindexedCount} files not yet indexed</div>` : ""}
  </div>
  <div class="viz-container" id="viz">
    <div class="tooltip" id="tooltip"></div>
  </div>
  <div class="details" id="details">
    <div class="loading">Loading...</div>
  </div>
</div>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
(function() {
  const hierarchyData = ${dataJson};
  const root = hierarchyData.root;
  const vizEl = document.getElementById("viz");
  const tooltipEl = document.getElementById("tooltip");
  const detailsEl = document.getElementById("details");
  const breadcrumbEl = document.getElementById("breadcrumb");

  const COLORS = {
    "bug-fix": "#da3633",
    "feature": "#2ea043",
    "refactor": "#d4a72c",
    "docs": "#58a6ff",
    "chore": "#8b949e",
    "perf": "#bc8cff",
    "test": "#39d3c5",
    "style": "#f0f0f0"
  };

  const scoreColor = d3.scaleLinear()
    .domain([0, 0.5, 1])
    .range(["#2ea043", "#d4a72c", "#da3633"])
    .interpolate(d3.interpolateRgb);

  const width = vizEl.clientWidth;
  const height = vizEl.clientHeight;

  const svg = d3.select("#viz")
    .append("svg")
    .attr("viewBox", \`0 0 \${width} \${height}\`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const g = svg.append("g");

  const h = d3.hierarchy(root)
    .sum(d => d.children ? 0 : (d.loc || 1))
    .sort((a, b) => (b.value || 0) - (a.value || 0));

  const pack = d3.pack()
    .size([width, height])
    .padding(3);

  pack(h);

  let focus = h;
  let view;

  const nodes = g.selectAll("circle")
    .data(h.descendants())
    .join("circle")
    .attr("fill", d => {
      if (d.children) return "rgba(255,255,255,0.03)";
      if (!d.data.indexed) return "#30363d";
      return scoreColor(d.data.score || 0);
    })
    .attr("stroke", d => d.children ? "rgba(255,255,255,0.08)" : "none")
    .attr("stroke-width", d => d.children ? 1 : 0)
    .attr("cursor", "pointer")
    .on("click", (event, d) => {
      event.stopPropagation();
      if (focus === d) {
        zoomTo(d.parent || h);
      } else if (d.children) {
        zoomTo(d);
      } else {
        // Leaf: zoom to parent, show file details
        zoomTo(d.parent || h);
        fetchDetails(d.data.path);
        updateBreadcrumb(d.data.path);
      }
    })
    .on("mouseenter", (event, d) => {
      if (!d.data.path) return;
      let html = \`<strong>\${d.data.path || d.data.name}</strong>\`;
      if (!d.children) {
        html += \`<br>LOC: \${d.data.loc || "—"}\`;
        html += \`<br>Changes: \${d.data.changes || 0}\`;
        html += \`<br>Score: \${(d.data.score || 0).toFixed(3)}\`;
        if (!d.data.indexed) html += \`<br><em>Not indexed</em>\`;
      }
      tooltipEl.innerHTML = html;
      tooltipEl.classList.add("visible");
    })
    .on("mousemove", (event) => {
      const rect = vizEl.getBoundingClientRect();
      tooltipEl.style.left = (event.clientX - rect.left + 12) + "px";
      tooltipEl.style.top = (event.clientY - rect.top - 10) + "px";
    })
    .on("mouseleave", () => {
      tooltipEl.classList.remove("visible");
    });

  const labels = g.selectAll("text")
    .data(h.descendants().filter(d => !d.children))
    .join("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.3em")
    .attr("fill", "#e6edf3")
    .attr("font-size", d => Math.min(d.r * 0.6, 12))
    .attr("pointer-events", "none")
    .text(d => d.data.name)
    .attr("opacity", d => d.r > 18 ? 1 : 0);

  function zoomView(v) {
    const k = Math.min(width, height) / v[2] * 0.95;
    view = v;
    nodes.attr("transform", d =>
      \`translate(\${(d.x - v[0]) * k + width / 2},\${(d.y - v[1]) * k + height / 2})\`
    ).attr("r", d => d.r * k);

    labels.attr("transform", d =>
      \`translate(\${(d.x - v[0]) * k + width / 2},\${(d.y - v[1]) * k + height / 2})\`
    ).attr("font-size", d => Math.min(d.r * k * 0.6, 12))
     .attr("opacity", d => d.r * k > 18 ? 1 : 0);
  }

  function zoomTo(d) {
    focus = d;
    const transition = svg.transition()
      .duration(500)
      .tween("zoom", () => {
        const i = d3.interpolateZoom(view, [d.x, d.y, d.r * 2]);
        return t => zoomView(i(t));
      });

    const detailPath = d === h ? "" : d.data.path;
    fetchDetails(detailPath);
    updateBreadcrumb(detailPath);
  }

  let detailsAbort = null;

  zoomView([h.x, h.y, h.r * 2]);
  fetchDetails("");

  svg.on("click", () => {
    if (focus !== h) zoomTo(focus.parent || h);
  });

  function updateBreadcrumb(path) {
    if (!path) {
      breadcrumbEl.innerHTML = "";
      return;
    }
    const parts = path.replace(/\\/$/, "").split("/");
    let html = '<span data-path="">root</span>';
    let accumulated = "";
    for (let i = 0; i < parts.length; i++) {
      accumulated += parts[i] + (i < parts.length - 1 ? "/" : "");
      const displayPath = accumulated + (i < parts.length - 1 ? "/" : "");
      html += ' / <span data-path="' + displayPath + '">' + parts[i] + '</span>';
    }
    breadcrumbEl.innerHTML = html;
    breadcrumbEl.querySelectorAll("span").forEach(span => {
      span.addEventListener("click", () => {
        const p = span.dataset.path;
        if (p === "") {
          zoomTo(h);
        } else {
          const target = h.descendants().find(d => d.data.path === p);
          if (target) zoomTo(target);
        }
      });
    });
  }

  function fetchDetails(path) {
    if (detailsAbort) detailsAbort.abort();
    detailsAbort = new AbortController();
    detailsEl.innerHTML = '<div class="loading">Loading...</div>';
    const query = path || "/";
    fetch("/api/details?path=" + encodeURIComponent(query), { signal: detailsAbort.signal })
      .then(r => r.json())
      .then(data => renderDetails(data))
      .catch(err => {
        if (err.name !== "AbortError") {
          detailsEl.innerHTML = '<div class="loading">Failed to load details</div>';
        }
      });
  }

  function renderDetails(data) {
    let html = "";

    if (data.type === "root") {
      html += '<h2>Repository Overview</h2>';
      html += '<div class="stat-grid">';
      html += statItem(fmt(data.totalCommits), "Total commits");
      html += statItem(fmt(data.enrichedCommits), "Enriched");
      html += statItem(data.enrichmentPct + "%", "Enrichment");
      html += statItem(fmt(hierarchyData.totalTracked), "Tracked files");
      html += '</div>';

      if (data.hotspots && data.hotspots.length > 0) {
        html += '<h3>Top Hotspots</h3>';
        html += data.hotspots.map(h =>
          '<div class="list-item"><span class="list-file">' + h.file +
          '</span><span class="list-value">' + h.changes + ' changes</span></div>'
        ).join("");
      }

      if (data.coupledPairs && data.coupledPairs.length > 0) {
        html += '<h3>Top Coupled Pairs</h3>';
        html += data.coupledPairs.map(p =>
          '<div class="list-item"><span class="list-file" style="max-width:90%;font-size:12px">' +
          p.fileA + ' &harr; ' + p.fileB +
          '</span><span class="list-value">' + p.count + '</span></div>'
        ).join("");
      }

      html += trendHtml(data.trendSummary);

    } else if (data.type === "directory") {
      html += '<h2>' + data.path + '</h2>';
      html += '<div class="stat-grid">';
      html += statItem(fmt(data.fileCount), "Files");
      if (data.stats) {
        html += statItem(fmt(data.stats.current_loc || 0), "LOC");
        html += statItem(fmt(data.stats.total_changes), "Total changes");
        html += statItem((data.stats.current_complexity || 0).toFixed(1), "Avg complexity");
      }
      html += '</div>';

      if (data.stats) html += classificationBar(data.stats);

      if (data.hotspots && data.hotspots.length > 0) {
        html += '<h3>Hotspots</h3>';
        html += data.hotspots.map(h =>
          '<div class="list-item"><span class="list-file">' + h.file +
          '</span><span class="list-value">' + h.changes + '</span></div>'
        ).join("");
      }

      if (data.contributors && data.contributors.length > 0) {
        html += '<h3>Contributors</h3>';
        html += data.contributors.map(c =>
          '<div class="list-item"><span>' + c.name +
          '</span><span class="list-value">' + c.commits + ' commits</span></div>'
        ).join("");
      }

      if (data.coupled && data.coupled.length > 0) {
        html += '<h3>External Coupling</h3>';
        html += data.coupled.map(c =>
          '<div class="list-item"><span class="list-file">' + c.file +
          '</span><span class="list-value">' + (c.ratio * 100).toFixed(0) + '%</span></div>'
        ).join("");
      }

      html += trendHtml(data.trendSummary);

    } else if (data.type === "file") {
      html += '<h2>' + data.path + '</h2>';
      if (data.stats) {
        html += '<div class="stat-grid">';
        html += statItem(fmt(data.stats.current_loc || 0), "LOC");
        html += statItem(fmt(data.stats.total_changes), "Changes");
        html += statItem((data.stats.current_complexity || 0).toFixed(1), "Complexity");
        html += statItem(data.stats.first_seen ? data.stats.first_seen.slice(0, 10) : "—", "First seen");
        html += statItem(data.stats.last_changed ? data.stats.last_changed.slice(0, 10) : "—", "Last changed");
        html += statItem(fmt(data.stats.total_additions), "Additions");
        html += '</div>';

        html += classificationBar(data.stats);
      } else {
        html += '<div class="loading">No index data for this file</div>';
      }

      if (data.contributors && data.contributors.length > 0) {
        html += '<h3>Contributors</h3>';
        html += data.contributors.map(c =>
          '<div class="list-item"><span>' + c.name +
          '</span><span class="list-value">' + c.commits + ' commits</span></div>'
        ).join("");
      }

      if (data.coupled && data.coupled.length > 0) {
        html += '<h3>Coupled Files</h3>';
        html += data.coupled.map(c =>
          '<div class="list-item"><span class="list-file">' + c.file +
          '</span><span class="list-value">' + (c.ratio * 100).toFixed(0) + '%</span></div>'
        ).join("");
      }

      html += trendHtml(data.trendSummary);
    }

    detailsEl.innerHTML = html;
  }

  function statItem(value, label) {
    return '<div class="stat-item"><div class="stat-value">' + value +
           '</div><div class="stat-label">' + label + '</div></div>';
  }

  function fmt(n) {
    if (n == null) return "—";
    return n.toLocaleString();
  }

  function classificationBar(stats) {
    const types = [
      { key: "bug_fix_count", label: "bug-fix", color: COLORS["bug-fix"] },
      { key: "feature_count", label: "feature", color: COLORS["feature"] },
      { key: "refactor_count", label: "refactor", color: COLORS["refactor"] },
      { key: "docs_count", label: "docs", color: COLORS["docs"] },
      { key: "chore_count", label: "chore", color: COLORS["chore"] },
      { key: "perf_count", label: "perf", color: COLORS["perf"] },
      { key: "test_count", label: "test", color: COLORS["test"] },
      { key: "style_count", label: "style", color: COLORS["style"] },
    ];
    const total = types.reduce((sum, t) => sum + (stats[t.key] || 0), 0);
    if (total === 0) return "";
    let html = '<h3>Classification</h3><div class="class-bar">';
    for (const t of types) {
      const pct = ((stats[t.key] || 0) / total * 100);
      if (pct > 0) {
        html += '<div style="width:' + pct + '%;background:' + t.color + '" title="' + t.label + ': ' + stats[t.key] + '"></div>';
      }
    }
    html += '</div><div class="class-legend">';
    for (const t of types) {
      if (stats[t.key] > 0) {
        html += '<span><span class="dot" style="background:' + t.color + '"></span>' + t.label + ' ' + stats[t.key] + '</span>';
      }
    }
    html += '</div>';
    return html;
  }

  function trendHtml(trend) {
    if (!trend) return "";
    let html = '<h3>Trends</h3>';
    html += '<div class="trend-indicator ' + trendClass(trend.direction) + '">';
    html += trendArrow(trend.direction) + ' Activity: ' + trend.direction;
    html += ' (' + trend.recent_avg + ' vs ' + trend.historical_avg + '/period)';
    html += '</div><br>';
    html += '<div class="trend-indicator ' + trendClass(trend.bug_fix_trend) + '">';
    html += trendArrow(trend.bug_fix_trend) + ' Bug fixes: ' + trend.bug_fix_trend;
    html += '</div><br>';
    html += '<div class="trend-indicator ' + trendClass(trend.complexity_trend) + '">';
    html += trendArrow(trend.complexity_trend) + ' Complexity: ' + trend.complexity_trend;
    html += '</div>';
    return html;
  }

  function trendClass(dir) {
    if (dir === "increasing") return "trend-up";
    if (dir === "decreasing") return "trend-down";
    return "trend-stable";
  }

  function trendArrow(dir) {
    if (dir === "increasing") return "&#9650;";
    if (dir === "decreasing") return "&#9660;";
    return "&#9654;";
  }
})();
</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
