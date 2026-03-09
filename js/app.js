// Profile dropdown toggle
  const profileIcon = document.getElementById('profileIcon');
  const profileMenu = document.getElementById('profileMenu');

  profileIcon.addEventListener('click', () => {
    profileMenu.style.display = profileMenu.style.display === 'block' ? 'none' : 'block';
  });

  // Close dropdown if click outside
  document.addEventListener('click', (e) => {
    if(!profileIcon.contains(e.target)) {
      profileMenu.style.display = 'none';
    }
  });

const streakBox = document.getElementById('streakBox');

// For now, we force the condition to true to test
let problemsCompleted = 3; // you can change this number

if (problemsCompleted >= 3) {
  streakBox.classList.add('streak-achieved');
} else {
  streakBox.classList.remove('streak-achieved');
}

