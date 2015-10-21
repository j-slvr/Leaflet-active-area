(function(previousMethods){
if (typeof previousMethods === 'undefined') {
    // Defining previously that object allows you to use that plugin even if you have overridden L.map
    previousMethods = {
        getCenter: L.Map.prototype.getCenter,
        setView: L.Map.prototype.setView,
        setZoomAround: L.Map.prototype.setZoomAround,
        getBoundsZoom: L.Map.prototype.getBoundsZoom
    };
}


L.Map.include({
    getBounds: function() {
        if (this._viewport) {
            return this.getViewportLatLngBounds()
        } else {
            var bounds = this.getPixelBounds(),
            sw = this.unproject(bounds.getBottomLeft()),
            ne = this.unproject(bounds.getTopRight());

            return new L.LatLngBounds(sw, ne);
        }
    },

    getViewport: function() {
        return this._viewport;
    },

    getViewportBounds: function() {
        var vp = this._viewport,
            topleft = L.point(vp.offsetLeft, vp.offsetTop),
            vpsize = L.point(vp.clientWidth, vp.clientHeight);

        if (vpsize.x === 0 || vpsize.y === 0) {
            //Our own viewport has no good size - so we fallback to the container size:
            vp = this.getContainer();
            if(vp){
              topleft = L.point(0, 0);
              vpsize = L.point(vp.clientWidth, vp.clientHeight);
            }

        }

        return L.bounds(topleft, topleft.add(vpsize));
    },

    getViewportLatLngBounds: function() {
        var bounds = this.getViewportBounds();
        return L.latLngBounds(this.containerPointToLatLng(bounds.min), this.containerPointToLatLng(bounds.max));
    },

    getOffset: function() {
        var mCenter = this.getSize().divideBy(2),
            vCenter = this.getViewportBounds().getCenter();

        return mCenter.subtract(vCenter);
    },

    getCenter: function (withoutViewport) {
        var center = previousMethods.getCenter.call(this);

        if (this.getViewport() && !withoutViewport) {
            var zoom = this.getZoom(),
                point = this.project(center, zoom);
            point = point.subtract(this.getOffset());

            center = this.unproject(point, zoom);
        }

        return center;
    },

    setView: function (center, zoom, options) {
        center = L.latLng(center);
        zoom = zoom === undefined ? this._zoom : this._limitZoom(zoom);

        if (this.getViewport()) {
            var point = this.project(center, this._limitZoom(zoom));
            point = point.add(this.getOffset());
            center = this.unproject(point, this._limitZoom(zoom));
        }

        return previousMethods.setView.call(this, center, zoom, options);
    },

    setZoomAround: function (latlng, zoom, options) {
        var vp = this.getViewport();

        if (vp) {
            var scale = this.getZoomScale(zoom),
                viewHalf = this.getViewportBounds().getCenter(),
                containerPoint = latlng instanceof L.Point ? latlng : this.latLngToContainerPoint(latlng),

                centerOffset = containerPoint.subtract(viewHalf).multiplyBy(1 - 1 / scale),
                newCenter = this.containerPointToLatLng(viewHalf.add(centerOffset));

            return this.setView(newCenter, zoom, {zoom: options});
        } else {
            return previousMethods.setZoomAround.call(this, latlng, zoom, options);
        }
    },

    getBoundsZoom: function (bounds, inside, padding) { // (LatLngBounds[, Boolean, Point]) -> Number
        bounds = L.latLngBounds(bounds);

        var zoom = this.getMinZoom() - (inside ? 1 : 0),
            maxZoom = this.getMaxZoom(),
            vp = this.getViewport(),
            size = (vp) ? L.point(vp.clientWidth, vp.clientHeight) : this.getSize(),

            nw = bounds.getNorthWest(),
            se = bounds.getSouthEast(),

            zoomNotFound = true,
            boundsSize;

        padding = L.point(padding || [0, 0]);

        do {
            zoom++;
            boundsSize = this.project(se, zoom).subtract(this.project(nw, zoom)).add(padding);
            zoomNotFound = !inside ? size.contains(boundsSize) : boundsSize.x < size.x || boundsSize.y < size.y;

        } while (zoomNotFound && zoom <= maxZoom);

        if (zoomNotFound && inside) {
            return null;
        }

        return inside ? zoom : zoom - 1;
    }

});

L.Map.include({
    setActiveArea: function (css) {
        if( !this._viewport ){
            //Make viewport if not already made
            var container = this.getContainer();
            this._viewport = L.DomUtil.create('div', '');
            container.insertBefore(this._viewport, container.firstChild);
        }

        if (typeof css === 'string') {
            this._viewport.className = css;
        } else {
            L.extend(this._viewport.style, css);
        }
        return this;
    }
});

L.Renderer.include({
    _updateTransform: function () {
        var zoom = this._map.getZoom(),
            center = this._map.getCenter(true),
            scale = this._map.getZoomScale(zoom, this._zoom),
            offset = this._map._latLngToNewLayerPoint(this._topLeft, zoom, center);

        L.DomUtil.setTransform(this._container, offset, scale);
    }
});

L.GridLayer.include({
    _updateLevels: function () {

        var zoom = this._tileZoom,
            maxZoom = this.options.maxZoom;

        for (var z in this._levels) {
            if (this._levels[z].el.children.length || z === zoom) {
                this._levels[z].el.style.zIndex = maxZoom - Math.abs(zoom - z);
            } else {
                L.DomUtil.remove(this._levels[z].el);
                delete this._levels[z];
            }
        }

        var level = this._levels[zoom],
            map = this._map;

        if (!level) {
            level = this._levels[zoom] = {};

            level.el = L.DomUtil.create('div', 'leaflet-tile-container leaflet-zoom-animated', this._container);
            level.el.style.zIndex = maxZoom;

            level.origin = map.project(map.unproject(map.getPixelOrigin()), zoom).round();
            level.zoom = zoom;

            this._setZoomTransform(level, map.getCenter(true), map.getZoom());

            // force the browser to consider the newly added element for transition
            L.Util.falseFn(level.el.offsetWidth);
        }

        this._level = level;

        return level;
    },

    _resetView: function (e) {
        var pinch = e && e.pinch;
        this._setView(this._map.getCenter(true), this._map.getZoom(), pinch, pinch);
    },

    _update: function (center, zoom) {

        var map = this._map;
        if (!map) { return; }

        if (center === undefined) { center = map.getCenter(true); }
        if (zoom === undefined) { zoom = map.getZoom(); }
        var tileZoom = Math.round(zoom);

        if (tileZoom > this.options.maxZoom ||
            tileZoom < this.options.minZoom) { return; }

        var pixelBounds = this._getTiledPixelBounds(center, zoom, tileZoom);

        var tileRange = this._pxBoundsToTileRange(pixelBounds),
            tileCenter = tileRange.getCenter(),
            queue = [];

        for (var key in this._tiles) {
            this._tiles[key].current = false;
        }

        // create a queue of coordinates to load tiles from
        for (var j = tileRange.min.y; j <= tileRange.max.y; j++) {
            for (var i = tileRange.min.x; i <= tileRange.max.x; i++) {
                var coords = new L.Point(i, j);
                coords.z = tileZoom;

                if (!this._isValidTile(coords)) { continue; }

                var tile = this._tiles[this._tileCoordsToKey(coords)];
                if (tile) {
                    tile.current = true;
                } else {
                    queue.push(coords);
                }
            }
        }

        // sort tile queue to load tiles in order of their distance to center
        queue.sort(function (a, b) {
            return a.distanceTo(tileCenter) - b.distanceTo(tileCenter);
        });

        if (queue.length !== 0) {
            // if its the first batch of tiles to load
            if (!this._loading) {
                this._loading = true;
                this.fire('loading');
            }

            // create DOM fragment to append tiles in one batch
            var fragment = document.createDocumentFragment();

            for (i = 0; i < queue.length; i++) {
                this._addTile(queue[i], fragment);
            }

            this._level.el.appendChild(fragment);
        }
    }
});
})(window.leafletActiveAreaPreviousMethods);
