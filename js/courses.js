const profileIcon = document.getElementById('profileIcon');
const profileMenu = document.getElementById('profileMenu');

profileIcon.addEventListener('click', () => {
  profileMenu.style.display = profileMenu.style.display === 'block' ? 'none' : 'block';
});

document.addEventListener('click', (event) => {
  if (!profileIcon.contains(event.target)) {
    profileMenu.style.display = 'none';
  }
});

const roadmapPanel = document.getElementById('roadmapPanel');
const slidesPanel = document.getElementById('slidesPanel');
const levelList = document.getElementById('levelList');
const closeRoadmap = document.getElementById('closeRoadmap');
const closeSlides = document.getElementById('closeSlides');
const slideBody = document.getElementById('slideBody');
const slideCounter = document.getElementById('slideCounter');
const slideLevelTitle = document.getElementById('slideLevelTitle');
const prevSlide = document.getElementById('prevSlide');
const nextSlide = document.getElementById('nextSlide');
const slideQuiz = document.getElementById('slideQuiz');
const quizAnswer = document.getElementById('quizAnswer');
const quizFeedback = document.getElementById('quizFeedback');
const comingSoonToast = document.getElementById('comingSoonToast');

const levels = [
  {
    title: 'Level 1: Counting Basics',
    slides: [
      {
        text: 'Welcome to Combinatorics Level 1.\\n\\nIn this mini-lesson, you will learn when to add and when to multiply cases in counting problems.'
      },
      {
        text: 'Rule of Sum: use addition when options are mutually exclusive.\\n\\nRule of Product: multiply when choices happen in sequence.',
        question: 'If you have 3 red pens and 4 blue pens and choose exactly one pen, how many total choices are there?',
        acceptedAnswers: ['7', 'seven']
      },
      {
        text: 'Great work — now you can combine both rules for tougher olympiad setups.',
        question: 'How many 2-digit numbers can be formed with first digit from {1,2,3} and second digit from {4,5}?',
        acceptedAnswers: ['6', 'six']
      }
    ]
  },
  {
    title: 'Level 2: Pigeonhole Principle',
    slides: [{ text: 'Coming next: place your lesson slides here.' }]
  },
  {
    title: 'Level 3: Extremal Strategies',
    slides: [{ text: 'Coming next: place your lesson slides here.' }]
  },
  {
    title: 'Level 4: Invariants and Monovariants',
    slides: [{ text: 'Coming next: place your lesson slides here.' }]
  }
];

let unlockedLevel = 0;
let completedLevel = -1;
let currentLevel = 0;
let currentSlide = 0;
const solvedSlides = new Set();

function showToast(message) {
  comingSoonToast.textContent = message;
  comingSoonToast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    comingSoonToast.classList.add('hidden');
  }, 1700);
}

function slideKey(levelIndex, slideIndex) {
  return `${levelIndex}:${slideIndex}`;
}

function normalizeAnswer(answer) {
  return answer.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function evaluateAnswer(input, acceptedAnswers) {
  const normalizedInput = normalizeAnswer(input);
  return acceptedAnswers.some((answer) => {
    const normalizedExpected = normalizeAnswer(answer);
    return (
      normalizedInput === normalizedExpected ||
      normalizedInput.includes(normalizedExpected) ||
      normalizedExpected.includes(normalizedInput)
    );
  });
}

function markLevelCompleteIfDone() {
  const isLastSlide = currentSlide === levels[currentLevel].slides.length - 1;
  if (!isLastSlide) {
    return;
  }

  if (currentLevel >= unlockedLevel) {
    completedLevel = Math.max(completedLevel, currentLevel);
    if (unlockedLevel < levels.length - 1) {
      unlockedLevel += 1;
      showToast('Nice! Level finished. Next level unlocked.');
    } else {
      showToast('Amazing! You completed the final level.');
    }
  }

  slidesPanel.classList.add('hidden');
  openRoadmap();
}

function renderLevels() {
  levelList.innerHTML = '';

  levels.forEach((level, index) => {
    const button = document.createElement('button');
    button.className = 'level-btn';
    button.textContent = level.title;

    if (index <= unlockedLevel) {
      button.classList.add('unlocked');
    }

    if (index <= completedLevel) {
      button.classList.add('done');
      button.textContent += ' ✓';
    }

    button.addEventListener('click', () => {
      if (index > unlockedLevel) {
        showToast('Finish the previous level first.');
        return;
      }

      openLevel(index);
    });

    levelList.appendChild(button);
  });
}

function openRoadmap() {
  roadmapPanel.classList.remove('hidden');
  slidesPanel.classList.add('hidden');
  renderLevels();
}

function closeRoadmapPanel() {
  roadmapPanel.classList.add('hidden');
}

function openLevel(levelIndex) {
  currentLevel = levelIndex;
  currentSlide = 0;
  slideLevelTitle.textContent = levels[levelIndex].title;
  roadmapPanel.classList.add('hidden');
  slidesPanel.classList.remove('hidden');
  renderSlide();
}

function updateNextButtonState(slide) {
  const isLastSlide = currentSlide >= levels[currentLevel].slides.length - 1;
  nextSlide.textContent = isLastSlide ? 'Finish' : 'Next ▶';

  const hasQuestion = Boolean(slide.question);
  const solved = solvedSlides.has(slideKey(currentLevel, currentSlide));

  if (hasQuestion && !solved) {
    nextSlide.disabled = true;
    return;
  }

  nextSlide.disabled = false;
}

function renderSlide() {
  const slides = levels[currentLevel].slides;
  const current = slides[currentSlide];
  slideBody.textContent = current.text;
  slideCounter.textContent = `${currentSlide + 1} / ${slides.length}`;
  prevSlide.disabled = currentSlide === 0;

  if (current.question) {
    slideQuiz.classList.remove('hidden');
    quizFeedback.textContent = current.question;
    quizFeedback.classList.remove('success');
    quizAnswer.value = '';
  } else {
    slideQuiz.classList.add('hidden');
    quizFeedback.textContent = '';
    quizFeedback.classList.remove('success');
  }

  updateNextButtonState(current);
}

document.querySelectorAll('.topic-card').forEach((card) => {
  card.addEventListener('click', () => {
    if (card.dataset.topic === 'combinatorics') {
      openRoadmap();
      return;
    }

    showToast('Coming soon 🚧');
  });
});

slideQuiz.addEventListener('submit', (event) => {
  event.preventDefault();
  const current = levels[currentLevel].slides[currentSlide];
  if (!current.question) {
    return;
  }

  const input = quizAnswer.value.trim();
  if (!input) {
    quizFeedback.textContent = 'Please type an answer first.';
    quizFeedback.classList.remove('success');
    return;
  }

  const isCorrect = evaluateAnswer(input, current.acceptedAnswers || []);

  if (isCorrect) {
    solvedSlides.add(slideKey(currentLevel, currentSlide));
    quizFeedback.textContent = '✅ Right! You can continue.';
    quizFeedback.classList.add('success');
    updateNextButtonState(current);
    return;
  }

  quizFeedback.textContent = 'Not quite. Try again with a concise final answer.';
  quizFeedback.classList.remove('success');
});

closeRoadmap.addEventListener('click', closeRoadmapPanel);

closeSlides.addEventListener('click', () => {
  slidesPanel.classList.add('hidden');
  openRoadmap();
});

prevSlide.addEventListener('click', () => {
  if (currentSlide > 0) {
    currentSlide -= 1;
    renderSlide();
  }
});

nextSlide.addEventListener('click', () => {
  const slides = levels[currentLevel].slides;
  const isLastSlide = currentSlide === slides.length - 1;

  if (isLastSlide) {
    markLevelCompleteIfDone();
    return;
  }

  if (currentSlide < slides.length - 1) {
    currentSlide += 1;
    renderSlide();
  }
});
