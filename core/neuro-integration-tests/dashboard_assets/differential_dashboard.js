// Differential Testing Dashboard JavaScript

document.addEventListener('DOMContentLoaded', function() {
    initializeDashboard();
});

function initializeDashboard() {
    // Initialize image modal functionality
    initializeImageModal();
    
    // Initialize test card interactions
    initializeTestCards();
    
    // Initialize metric highlighting
    initializeMetricHighlighting();
    
    // Initialize tooltips
    initializeTooltips();
    
    // Add smooth scrolling
    initializeSmoothScrolling();
    
    console.log('Differential Testing Dashboard initialized');
}

// Image Modal Functionality
function initializeImageModal() {
    // Create modal element
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="modal-close">&times;</span>
            <img src="" alt="Full size image">
        </div>
    `;
    document.body.appendChild(modal);
    
    const modalImg = modal.querySelector('img');
    const closeBtn = modal.querySelector('.modal-close');
    
    // Add click handlers to all comparison images
    document.querySelectorAll('.comparison-image').forEach(img => {
        img.addEventListener('click', function() {
            modalImg.src = this.src;
            modalImg.alt = this.alt;
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    });
    
    // Close modal functionality
    function closeModal() {
        modal.classList.remove('active');
        document.body.style.overflow = 'auto';
    }
    
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeModal();
        }
    });
    
    // Close on escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeModal();
        }
    });
}

// Test Card Interactions
function initializeTestCards() {
    document.querySelectorAll('.test-card').forEach(card => {
        // Add hover effects for better UX
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-5px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(-2px)';
        });
        
        // Add click to expand/collapse functionality
        const header = card.querySelector('.test-header');
        header.style.cursor = 'pointer';
        
        header.addEventListener('click', function() {
            const content = card.querySelector('.comparison-section');
            const metrics = card.querySelector('.metrics-section');
            
            if (content.style.display === 'none') {
                content.style.display = 'block';
                metrics.style.display = 'block';
                card.classList.add('expanded');
            } else {
                content.style.display = 'none';
                metrics.style.display = 'none';
                card.classList.remove('expanded');
            }
        });
    });
}

// Metric Highlighting
function initializeMetricHighlighting() {
    document.querySelectorAll('.metric-value').forEach(metric => {
        const value = parseFloat(metric.textContent);
        const label = metric.parentElement.querySelector('span:first-child').textContent.toLowerCase();
        
        // Color-code metrics based on typical thresholds
        if (label.includes('dice') || label.includes('jaccard')) {
            if (value >= 0.95) {
                metric.style.color = '#28a745'; // Excellent
            } else if (value >= 0.8) {
                metric.style.color = '#ffc107'; // Good
            } else {
                metric.style.color = '#dc3545'; // Poor
            }
        } else if (label.includes('ssim')) {
            if (value >= 0.9) {
                metric.style.color = '#28a745'; // Excellent
            } else if (value >= 0.7) {
                metric.style.color = '#ffc107'; // Good
            } else {
                metric.style.color = '#dc3545'; // Poor
            }
        } else if (label.includes('rmse') || label.includes('error')) {
            if (value <= 5.0) {
                metric.style.color = '#28a745'; // Excellent
            } else if (value <= 20.0) {
                metric.style.color = '#ffc107'; // Good
            } else {
                metric.style.color = '#dc3545'; // Poor
            }
        } else if (label.includes('diff pixels')) {
            if (value <= 1.0) {
                metric.style.color = '#28a745'; // Excellent
            } else if (value <= 5.0) {
                metric.style.color = '#ffc107'; // Good
            } else {
                metric.style.color = '#dc3545'; // Poor
            }
        }
    });
}

// Tooltips
function initializeTooltips() {
    const tooltips = {
        'dice': 'Dice Coefficient: Measures overlap similarity (0-1, higher is better)',
        'jaccard': 'Jaccard Index: Intersection over Union metric (0-1, higher is better)', 
        'ssim': 'Structural Similarity Index: Perceptual image similarity (-1 to 1, higher is better)',
        'psnr': 'Peak Signal-to-Noise Ratio: Image quality metric (dB, higher is better)',
        'rmse': 'Root Mean Square Error: Pixel-level difference (lower is better)',
        'error': 'Maximum absolute pixel difference (0-255, lower is better)',
        'diff pixels': 'Percentage of pixels that differ between CPU and GPU (lower is better)'
    };
    
    document.querySelectorAll('.metric-row').forEach(row => {
        const label = row.querySelector('span:first-child').textContent.toLowerCase();
        
        for (const [key, tooltip] of Object.entries(tooltips)) {
            if (label.includes(key)) {
                row.title = tooltip;
                row.style.cursor = 'help';
                break;
            }
        }
    });
}

// Smooth Scrolling
function initializeSmoothScrolling() {
    // Add "Back to Top" button
    const backToTop = document.createElement('div');
    backToTop.innerHTML = '↑';
    backToTop.className = 'back-to-top';
    backToTop.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 50px;
        height: 50px;
        background: #667eea;
        color: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 20px;
        font-weight: bold;
        opacity: 0;
        transition: all 0.3s ease;
        z-index: 1000;
    `;
    document.body.appendChild(backToTop);
    
    // Show/hide back to top button
    window.addEventListener('scroll', function() {
        if (window.scrollY > 300) {
            backToTop.style.opacity = '1';
        } else {
            backToTop.style.opacity = '0';
        }
    });
    
    // Smooth scroll to top
    backToTop.addEventListener('click', function() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

// Utility Functions
function formatMetricValue(value, type) {
    switch(type) {
        case 'percentage':
            return (value * 100).toFixed(1) + '%';
        case 'decimal':
            return value.toFixed(3);
        case 'integer':
            return Math.round(value);
        case 'db':
            return value.toFixed(1) + ' dB';
        default:
            return value.toString();
    }
}

function getMetricStatus(value, thresholds) {
    if (value >= thresholds.excellent) return 'excellent';
    if (value >= thresholds.good) return 'good';
    if (value >= thresholds.poor) return 'poor';
    return 'failed';
}

// Export for potential external use
window.DifferentialDashboard = {
    formatMetricValue,
    getMetricStatus,
    reinitialize: initializeDashboard
};