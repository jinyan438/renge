type HtmlPreviewContentSegment = {
  type: "text" | "html";
  content: string;
};

type HtmlPreviewStyleMessage = {
  role?: string;
  content?: string;
};

function isHtmlStylesheetLink(resource: string) {
  return /\brel\s*=\s*(?:"[^"]*\bstylesheet\b[^"]*"|'[^']*\bstylesheet\b[^']*'|stylesheet\b)/i.test(
    resource,
  );
}

export function collectInheritedHtmlPreviewStyleResources(
  messages: HtmlPreviewStyleMessage[],
  currentMessageIndex: number,
) {
  const inheritedResources = new Map<string, string>();
  const endIndex = Number.isFinite(currentMessageIndex)
    ? Math.max(0, Math.min(messages.length, Math.trunc(currentMessageIndex)))
    : 0;

  messages.slice(0, endIndex).forEach((message) => {
    if (message.role !== "assistant" || typeof message.content !== "string") return;

    const contentWithoutScripts = message.content.replace(
      /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
      "",
    );
    const resourcePattern = /<style\b[^>]*>[\s\S]*?<\/style\s*>|<link\b[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = resourcePattern.exec(contentWithoutScripts))) {
      const resource = match[0].trim();
      if (/^<link\b/i.test(resource) && !isHtmlStylesheetLink(resource)) continue;

      // An identical later resource supersedes its earlier occurrence. Moving
      // it to the end keeps CSS cascade order without cloning it per turn.
      inheritedResources.delete(resource);
      inheritedResources.set(resource, resource);
    }
  });

  return Array.from(inheritedResources.values()).join("\n");
}

function isHtmlPreviewSegmentGlue(content: string) {
  return content.replace(/<!--[\s\S]*?-->/g, "").trim().length === 0;
}

export function mergeWhitespaceSeparatedHtmlPreviewSegments(
  segments: HtmlPreviewContentSegment[],
) {
  const merged: HtmlPreviewContentSegment[] = [];

  segments.forEach((segment) => {
    const nextSegment = { ...segment };
    const previousSegment = merged[merged.length - 1];

    if (previousSegment?.type === nextSegment.type) {
      previousSegment.content += nextSegment.content;
      return;
    }

    const precedingHtmlSegment = merged[merged.length - 2];
    if (
      nextSegment.type === "html" &&
      previousSegment?.type === "text" &&
      precedingHtmlSegment?.type === "html" &&
      isHtmlPreviewSegmentGlue(previousSegment.content)
    ) {
      merged.pop();
      precedingHtmlSegment.content += previousSegment.content + nextSegment.content;
      return;
    }

    merged.push(nextSegment);
  });

  return merged;
}

export function stabilizeHtmlPreviewRuntimeCompatibility(content: string) {
  let stabilized = content.replace(
    /(\b(?:document\.getElementById|(?:document|[A-Za-z_$][\w$]*)\.querySelector)\([^;\r\n]*?\))\.addEventListener\s*\(/g,
    "$1?.addEventListener(",
  );

  stabilized = stabilized.replace(
    /\bawait\s+loadFabShortcutConfig\s*\(\s*\)\s*;/g,
    'if (typeof loadFabShortcutConfig === "function") await loadFabShortcutConfig();',
  );

  return stabilized;
}

export function stabilizeHtmlPreviewMapViewport(content: string) {
  let stabilized = content.replace(
    /(class\s+MapRenderer\s*\{[\s\S]*?\n\s+resize\(\)\s*\{)\s*this\.canvas\.width\s*=\s*this\.container\.clientWidth;\s*this\.canvas\.height\s*=\s*this\.container\.clientHeight;\s*this\.drawMap\(\);\s*\}/,
    `$1
            const nextWidth = this.container.clientWidth;
            const nextHeight = this.container.clientHeight;
            this.canvas.width = nextWidth;
            this.canvas.height = nextHeight;

            if (!this.__rengeInitialMapFit && nextWidth > 0 && nextHeight > 0 && this._mapData) {
              const mapPoints = [];
              const collectPoints = item => {
                if (Array.isArray(item?.points)) {
                  item.points.forEach(point => {
                    if (Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))) {
                      mapPoints.push([Number(point[0]), Number(point[1])]);
                    }
                  });
                } else if (Number.isFinite(Number(item?.x)) && Number.isFinite(Number(item?.y))) {
                  mapPoints.push([Number(item.x), Number(item.y)]);
                }
              };
              ['terrains', 'main_regions', 'sub_regions', 'points_of_interest'].forEach(key => {
                const items = this._mapData[key];
                if (Array.isArray(items)) items.forEach(collectPoints);
              });
              if (mapPoints.length === 0) {
                const mapWidth = Number(this._mapData.width);
                const mapHeight = Number(this._mapData.height);
                if (mapWidth > 0 && mapHeight > 0) mapPoints.push([0, 0], [mapWidth, mapHeight]);
              }
              if (mapPoints.length > 0) {
                const xs = mapPoints.map(point => point[0]);
                const ys = mapPoints.map(point => point[1]);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                const mapWidth = Math.max(1, maxX - minX);
                const mapHeight = Math.max(1, maxY - minY);
                const padding = 20;
                this.scale = Math.max(0.05, Math.min(5,
                  Math.max(1, nextWidth - padding * 2) / mapWidth,
                  Math.max(1, nextHeight - padding * 2) / mapHeight,
                ));
                this.offsetX = (nextWidth - mapWidth * this.scale) / 2 - minX * this.scale;
                this.offsetY = (nextHeight - mapHeight * this.scale) / 2 - minY * this.scale;
                this.__rengeInitialMapFit = true;
              }
            }
            this.drawMap();
          }`,
  );

  stabilized = stabilized.replace(
    /(async\s+function\s+openBirthLocationSelection\s*\(\s*\)\s*\{[\s\S]*?await\s+openMapManagement\s*\(\s*\)\s*;)(\s*\})/,
    `$1
          const __rengeMapChoices = document.querySelectorAll(
            '#map-list-container input[name="defaultMapSelection"]',
          );
          if (__rengeMapChoices.length === 1) {
            __rengeMapChoices[0].checked = true;
            await setDefaultMap();
            document.getElementById('map-management-overlay')?.classList.remove('visible');
            openMapSelection();
          }$2`,
  );

  return stabilized;
}
