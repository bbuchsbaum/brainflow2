
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
