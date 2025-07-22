
// Enhanced dashboard interactivity
document.addEventListener('DOMContentLoaded', function() {
    // Add click handlers for slice images
    document.querySelectorAll('.slice-image').forEach(img => {
        img.addEventListener('click', function() {
            // Create modal to show full-size image
            const modal = document.createElement('div');
            modal.className = 'image-modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <span class="close">&times;</span>
                    <img src="${this.src}" alt="Full size image">
                </div>
            `;
            document.body.appendChild(modal);
            
            modal.querySelector('.close').addEventListener('click', () => {
                modal.remove();
            });
            
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        });
    });
});

// Add modal styles dynamically
const style = document.createElement('style');
style.textContent = `
.image-modal {
    display: flex;
    position: fixed;
    z-index: 1000;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0,0,0,0.8);
    align-items: center;
    justify-content: center;
}

.modal-content {
    position: relative;
    max-width: 90%;
    max-height: 90%;
}

.modal-content img {
    width: 100%;
    height: auto;
}

.close {
    position: absolute;
    top: -40px;
    right: 0;
    color: white;
    font-size: 35px;
    font-weight: bold;
    cursor: pointer;
}

.close:hover {
    color: #ddd;
}
`;
document.head.appendChild(style);
