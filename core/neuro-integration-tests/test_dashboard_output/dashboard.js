
// Add click handlers to result cards
document.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', function() {
        const testIndex = this.getAttribute('data-test-index');
        showTestDetails(testIndex);
    });
});

function showTestDetails(testIndex) {
    const detailsSection = document.getElementById('details');
    const detailsContent = document.getElementById('details-content');
    
    // In a real implementation, this would load detailed test data
    detailsContent.innerHTML = `
        <h3>Test ${testIndex} Details</h3>
        <p>Detailed information about this test would appear here.</p>
        <p>This could include:</p>
        <ul>
            <li>Ellipsoid parameters (center, radii, orientation)</li>
            <li>Volume configuration</li>
            <li>Slice images (if generated)</li>
            <li>Difference maps</li>
            <li>Performance metrics</li>
        </ul>
    `;
    
    detailsSection.style.display = 'block';
    detailsSection.scrollIntoView({ behavior: 'smooth' });
}
