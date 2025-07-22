// Visual Debug Report JavaScript

class DebugReportViewer {
    constructor() {
        this.currentTest = 0;
        this.currentOrientation = 'axial';
        this.currentSliceIndex = 0;
        this.modal = null;
        
        this.init();
    }

    init() {
        this.setupTabSwitching();
        this.setupTestNavigation();
        this.setupImageModal();
        this.setupSliceNavigation();
        this.setupKeyboardShortcuts();
        
        // Show first test by default
        this.showTest(0);
    }

    setupTabSwitching() {
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const orientation = e.target.dataset.orientation;
                this.switchOrientation(orientation);
            });
        });
    }

    setupTestNavigation() {
        const testLinks = document.querySelectorAll('.test-link');
        testLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const testIndex = parseInt(e.target.dataset.test);
                this.showTest(testIndex);
            });
        });
    }

    setupImageModal() {
        // Create modal element
        this.modal = document.createElement('div');
        this.modal.className = 'image-modal';
        this.modal.innerHTML = `
            <span class="modal-close">&times;</span>
            <img class="modal-content" alt="Enlarged view">
            <div class="modal-info"></div>
        `;
        document.body.appendChild(this.modal);

        // Setup click handlers for images
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('slice-image')) {
                this.showImageModal(e.target);
            }
        });

        // Close modal handlers
        this.modal.querySelector('.modal-close').addEventListener('click', () => {
            this.hideImageModal();
        });

        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                this.hideImageModal();
            }
        });
    }

    setupSliceNavigation() {
        // Add slice navigation controls to each test section
        const testSections = document.querySelectorAll('.test-section');
        testSections.forEach((section, testIndex) => {
            this.addSliceControls(section, testIndex);
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            switch(e.key) {
                case 'Escape':
                    this.hideImageModal();
                    break;
                case 'ArrowLeft':
                    if (e.ctrlKey) {
                        this.previousTest();
                    } else {
                        this.previousSlice();
                    }
                    break;
                case 'ArrowRight':
                    if (e.ctrlKey) {
                        this.nextTest();
                    } else {
                        this.nextSlice();
                    }
                    break;
                case '1':
                    this.switchOrientation('axial');
                    break;
                case '2':
                    this.switchOrientation('coronal');
                    break;
                case '3':
                    this.switchOrientation('sagittal');
                    break;
            }
        });
    }

    switchOrientation(orientation) {
        this.currentOrientation = orientation;
        
        // Update tab buttons
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.remove('active');
            if (button.dataset.orientation === orientation) {
                button.classList.add('active');
            }
        });

        // Show/hide slice grids
        document.querySelectorAll('.slice-grid').forEach(grid => {
            grid.classList.remove('active');
            if (grid.dataset.orientation === orientation) {
                grid.classList.add('active');
            }
        });

        this.updateSliceControls();
    }

    showTest(testIndex) {
        this.currentTest = testIndex;
        
        // Update navigation
        document.querySelectorAll('.test-link').forEach((link, index) => {
            link.classList.remove('active');
            if (index === testIndex) {
                link.classList.add('active');
            }
        });

        // Scroll to test section
        const testSection = document.getElementById(`test-${testIndex}`);
        if (testSection) {
            testSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        this.updateSliceControls();
    }

    showImageModal(imageElement) {
        const modalImg = this.modal.querySelector('.modal-content');
        const modalInfo = this.modal.querySelector('.modal-info');
        
        modalImg.src = imageElement.src;
        modalImg.alt = imageElement.alt;
        
        // Add image information
        modalInfo.innerHTML = `
            <div class="modal-image-info">
                <h3>${imageElement.alt}</h3>
                <p>Click outside or press ESC to close</p>
                <p>Use arrow keys to navigate slices</p>
            </div>
        `;
        
        this.modal.classList.add('show');
    }

    hideImageModal() {
        this.modal.classList.remove('show');
    }

    addSliceControls(section, testIndex) {
        const sliceViewer = section.querySelector('.slice-viewer');
        if (!sliceViewer) return;

        const controls = document.createElement('div');
        controls.className = 'slice-controls';
        controls.innerHTML = `
            <button class="slice-button" id="prev-slice-${testIndex}">◀ Previous</button>
            <span class="slice-indicator" id="slice-indicator-${testIndex}">Slice 1 of 5</span>
            <button class="slice-button" id="next-slice-${testIndex}">Next ▶</button>
        `;

        sliceViewer.appendChild(controls);

        // Add event listeners
        const prevButton = controls.querySelector(`#prev-slice-${testIndex}`);
        const nextButton = controls.querySelector(`#next-slice-${testIndex}`);

        prevButton.addEventListener('click', () => this.previousSlice());
        nextButton.addEventListener('click', () => this.nextSlice());
    }

    updateSliceControls() {
        const currentSection = document.getElementById(`test-${this.currentTest}`);
        if (!currentSection) return;

        const sliceImages = currentSection.querySelectorAll(
            `.slice-grid[data-orientation="${this.currentOrientation}"] .slice-image`
        );
        
        const totalSlices = sliceImages.length;
        if (totalSlices === 0) return;

        // Ensure currentSliceIndex is within bounds
        this.currentSliceIndex = Math.max(0, Math.min(this.currentSliceIndex, totalSlices - 1));

        // Update slice indicator
        const indicator = currentSection.querySelector(`#slice-indicator-${this.currentTest}`);
        if (indicator) {
            indicator.textContent = `Slice ${this.currentSliceIndex + 1} of ${totalSlices}`;
        }

        // Update button states
        const prevButton = currentSection.querySelector(`#prev-slice-${this.currentTest}`);
        const nextButton = currentSection.querySelector(`#next-slice-${this.currentTest}`);

        if (prevButton) {
            prevButton.disabled = this.currentSliceIndex === 0;
        }
        if (nextButton) {
            nextButton.disabled = this.currentSliceIndex === totalSlices - 1;
        }

        // Highlight current slice
        sliceImages.forEach((img, index) => {
            img.style.border = index === this.currentSliceIndex ? 
                '3px solid #1976d2' : '2px solid transparent';
        });
    }

    previousSlice() {
        if (this.currentSliceIndex > 0) {
            this.currentSliceIndex--;
            this.updateSliceControls();
        }
    }

    nextSlice() {
        const currentSection = document.getElementById(`test-${this.currentTest}`);
        if (!currentSection) return;

        const sliceImages = currentSection.querySelectorAll(
            `.slice-grid[data-orientation="${this.currentOrientation}"] .slice-image`
        );

        if (this.currentSliceIndex < sliceImages.length - 1) {
            this.currentSliceIndex++;
            this.updateSliceControls();
        }
    }

    previousTest() {
        if (this.currentTest > 0) {
            this.showTest(this.currentTest - 1);
        }
    }

    nextTest() {
        const testSections = document.querySelectorAll('.test-section');
        if (this.currentTest < testSections.length - 1) {
            this.showTest(this.currentTest + 1);
        }
    }
}

// Utility functions for metrics visualization
class MetricsVisualizer {
    static addMetricColorCoding() {
        // Color-code metrics based on thresholds
        const metrics = document.querySelectorAll('.metric-value');
        metrics.forEach(metric => {
            const value = parseFloat(metric.textContent);
            const label = metric.previousElementSibling.textContent.toLowerCase();

            if (label.includes('dice')) {
                if (value >= 0.95) metric.classList.add('excellent');
                else if (value >= 0.90) metric.classList.add('good');
                else if (value >= 0.80) metric.classList.add('fair');
                else metric.classList.add('poor');
            }
        });
    }

    static createMetricsChart(testResults) {
        // Create a simple chart showing metrics across all tests
        // This would integrate with a charting library like Chart.js in a real implementation
        console.log('Metrics chart would be generated here', testResults);
    }
}

// Image comparison utilities
class ImageComparer {
    static createDifferenceOverlay(img1, img2) {
        // Create difference overlay between two images
        // This would use canvas for pixel-level comparison
        console.log('Difference overlay would be created here');
    }

    static addImageZoom() {
        // Add zoom functionality to images
        const images = document.querySelectorAll('.slice-image');
        images.forEach(img => {
            img.addEventListener('wheel', (e) => {
                e.preventDefault();
                const scale = e.deltaY > 0 ? 0.9 : 1.1;
                img.style.transform = `scale(${scale})`;
            });
        });
    }
}

// Performance monitoring
class PerformanceMonitor {
    constructor() {
        this.loadTimes = {};
        this.renderTimes = {};
    }

    markLoadStart(testId) {
        this.loadTimes[testId] = { start: performance.now() };
    }

    markLoadEnd(testId) {
        if (this.loadTimes[testId]) {
            this.loadTimes[testId].end = performance.now();
            this.loadTimes[testId].duration = 
                this.loadTimes[testId].end - this.loadTimes[testId].start;
        }
    }

    reportPerformance() {
        console.log('Load times:', this.loadTimes);
        console.log('Render times:', this.renderTimes);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const viewer = new DebugReportViewer();
    const performanceMonitor = new PerformanceMonitor();
    
    // Add metrics color coding
    MetricsVisualizer.addMetricColorCoding();
    
    // Add image zoom functionality
    ImageComparer.addImageZoom();
    
    // Show loading progress
    console.log('Debug report viewer initialized');
    
    // Add help overlay
    const helpOverlay = document.createElement('div');
    helpOverlay.className = 'help-overlay';
    helpOverlay.innerHTML = `
        <div class="help-content">
            <h3>Keyboard Shortcuts</h3>
            <ul>
                <li><kbd>←/→</kbd> Navigate slices</li>
                <li><kbd>Ctrl</kbd> + <kbd>←/→</kbd> Navigate tests</li>
                <li><kbd>1/2/3</kbd> Switch orientations</li>
                <li><kbd>Esc</kbd> Close modal/help</li>
            </ul>
            <p>Click images to enlarge. Hover for details.</p>
        </div>
    `;
    
    // Add help button
    const helpButton = document.createElement('button');
    helpButton.className = 'help-button';
    helpButton.textContent = '?';
    helpButton.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: #1976d2;
        color: white;
        border: none;
        cursor: pointer;
        font-size: 20px;
        z-index: 1000;
    `;
    
    document.body.appendChild(helpButton);
    
    helpButton.addEventListener('click', () => {
        alert('Debug Report Help\n\n' +
              'Keyboard Shortcuts:\n' +
              '← / → : Navigate slices\n' +
              'Ctrl + ← / → : Navigate tests\n' +
              '1 / 2 / 3 : Switch orientations (Axial/Coronal/Sagittal)\n' +
              'ESC : Close modal\n\n' +
              'Click images to enlarge them.\n' +
              'Use the tabs to switch between slice orientations.\n' +
              'Test navigation is available in the top panel.');
    });
});

// Export for potential module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        DebugReportViewer,
        MetricsVisualizer,
        ImageComparer,
        PerformanceMonitor
    };
}