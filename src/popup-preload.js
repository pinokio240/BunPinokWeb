const { ipcRenderer } = require('electron');

function reportSize() {
    const doc = document.documentElement;
    if (!doc) {
        return;
    }
    let contentWidth = doc.scrollWidth;
    let contentHeight = doc.scrollHeight;
    if (document.body) {
        if (document.body.scrollWidth > contentWidth) {
            contentWidth = document.body.scrollWidth;
        }
        if (document.body.scrollHeight > contentHeight) {
            contentHeight = document.body.scrollHeight;
        }
    }
    const width = Math.min(Math.max(contentWidth, 280), 800);
    const height = Math.min(Math.max(contentHeight, 180), 600);
    ipcRenderer.send('popup:resize', width, height);
}

window.addEventListener('load', () => {
    reportSize();
    setTimeout(reportSize, 150);
    setTimeout(reportSize, 500);
    setTimeout(reportSize, 1200);
});

if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
        reportSize();
    });
    const startObserve = () => {
        if (document.documentElement) {
            observer.observe(document.documentElement);
        }
        if (document.body) {
            observer.observe(document.body);
        }
    };
    if (document.body) {
        startObserve();
    } else {
        document.addEventListener('DOMContentLoaded', startObserve);
    }
}

setInterval(reportSize, 1500);
