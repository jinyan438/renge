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
  return content.replace(
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
}
