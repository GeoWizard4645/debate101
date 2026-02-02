document.addEventListener('DOMContentLoaded', () => {
    const ctaButton = document.getElementById('cta-button');

    // Smooth scroll or alert for the demo
    ctaButton.addEventListener('click', () => {
        alert('Navigating to latest debate files...');
    });

    // Simple scroll effect for navbar
    window.addEventListener('scroll', () => {
        const nav = document.querySelector('.navbar');
        if (window.scrollY > 50) {
            nav.style.backgroundColor = '#f8f8f8';
        } else {
            nav.style.backgroundColor = '#ffffff';
        }
    });
});