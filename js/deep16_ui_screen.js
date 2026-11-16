/* deep16_ui_screen.js - FiT tile graphics display (tiles-only). */
class Deep16ScreenUI {
    constructor(ui) {
        this.ui = ui;
        this.mode = 'tiles';
        this.TILE_WIDTH = 640;
        this.TILE_HEIGHT = 360;
        this.screenBaseAddress = 0xF1000;
        this.tileCanvas = null;
        this.tileCtx = null;
        this.tileImageData = null;
        this.initializeScreen();
    }

    initializeScreen() {
        const screenDisplay = document.getElementById('screen-display');
        if (!screenDisplay) return;

        screenDisplay.innerHTML = '';
        const canvas = document.createElement('canvas');
        canvas.id = 'screen-tile-canvas';
        canvas.className = 'screen-canvas visible';
        if (canvas.classList && canvas.classList.add) canvas.classList.add('visible');
        canvas.width = this.TILE_WIDTH;
        canvas.height = this.TILE_HEIGHT;
        screenDisplay.appendChild(canvas);
        if (screenDisplay.classList && screenDisplay.classList.add) screenDisplay.classList.add('tile-view');

        this.tileCanvas = canvas;
        if (typeof canvas.getContext === 'function') {
            this.tileCtx = canvas.getContext('2d');
            if (this.tileCtx) {
                this.tileCtx.imageSmoothingEnabled = false;
                if (typeof this.tileCtx.createImageData === 'function') {
                    this.tileImageData = this.tileCtx.createImageData(this.TILE_WIDTH, this.TILE_HEIGHT);
                }
            }
        }
    }

    setConsoleView(_mode) {
        this.mode = 'tiles';
        this.applyConsoleVisibility();
        this.updateScreenDisplay();
        return this.mode;
    }

    applyConsoleVisibility() {
        const display = document.getElementById('screen-display');
        if (display && display.classList) display.classList.add('tile-view');
        if (this.tileCanvas && this.tileCanvas.classList) this.tileCanvas.classList.add('visible');
    }

    updateScreenDisplay() {
        this.updateTileDisplay();
    }

    updateTileDisplay() {
        const engine = this.ui && this.ui.tileEngine;
        if (!engine || !this.tileCtx || !this.tileImageData) return;
        const pixels = engine.render();
        this.tileImageData.data.set(pixels);
        this.tileCtx.putImageData(this.tileImageData, 0, 0);
    }

    setActive(flag) {
        const screenDisplay = document.getElementById('screen-display');
        if (!screenDisplay) return;
        if (flag) screenDisplay.classList.add('screen-active');
        else screenDisplay.classList.remove('screen-active');
    }

    // The text screen is gone: the FiT canvas is the whole display. The few
    // methods the IDE core still calls are kept as no-ops, so the callers do
    // not have to know which screen they are talking to.
    isScreenMemory(_address) { return false; }
    handleScreenMemoryWrite(_address, _value) {}
    applyColumnMode() {}
    feedConsole(_bytes) {}
}
