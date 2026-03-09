const STORAGE_KEYS = {
  user: 'prism.daily.user',
  submissions: 'prism.daily.submissions'
};

const profileIcon = document.getElementById('profileIcon');
const profileMenu = document.getElementById('profileMenu');
const changeUserBtn = document.getElementById('changeUserBtn');
const userModal = document.getElementById('userModal');
const userForm = document.getElementById('userForm');
const userNameInput = document.getElementById('userNameInput');

const problemCode = document.getElementById('problemCode');
const problemTitle = document.getElementById('problemTitle');
const problemStatement = document.getElementById('problemStatement');
const problemSource = document.getElementById('problemSource');
const solutionInput = document.getElementById('solutionInput');
const apiKeyInput = document.getElementById('apiKeyInput');
const submitBtn = document.getElementById('submitBtn');
const submitFeedback = document.getElementById('submitFeedback');
const streakCount = document.getElementById('streakCount');

const leaderboardList = document.getElementById('leaderboardList');
const calendarTitle = document.getElementById('calendarTitle');
const calendarGrid = document.getElementById('calendarGrid');

const now = new Date();
const todayKey = getDateKey(now);
const currentMonth = now.getMonth();
const currentYear = now.getFullYear();

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getStoredSubmissions() {
  const raw = localStorage.getItem(STORAGE_KEYS.submissions);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

function saveSubmissions(submissions) {
  localStorage.setItem(STORAGE_KEYS.submissions, JSON.stringify(submissions));
}

function ensureUser() {
  const existing = localStorage.getItem(STORAGE_KEYS.user);
  if (!existing) {
    userModal.classList.add('visible');
    userModal.setAttribute('aria-hidden', 'false');
    return;
  }

  profileIcon.textContent = existing[0].toUpperCase();
}

function setUser(username) {
  localStorage.setItem(STORAGE_KEYS.user, username);
  profileIcon.textContent = username[0].toUpperCase();
  userModal.classList.remove('visible');
  userModal.setAttribute('aria-hidden', 'true');
  renderLeaderboard();
}

function renderTodayProblem() {
  const problem = window.DAILY_PROBLEMS[todayKey];

  if (!problem) {
    problemCode.textContent = 'No problem';
    problemTitle.textContent = 'No problem has been scheduled for today yet.';
    problemStatement.textContent = 'Add today to your problem bank generator.';
    problemSource.textContent = '';
    return;
  }

  problemCode.textContent = `Problem ${problem.code}`;
  problemTitle.textContent = problem.title;
  problemStatement.textContent = problem.statement;
  problemSource.textContent = `Source: ${problem.source}`;
}

function getElapsedFromMidnight() {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return Math.max(0, Math.floor((Date.now() - midnight.getTime()) / 1000));
}

function formatElapsed(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function estimateScoreLocally(answer) {
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  const hasStructure = /(claim|therefore|hence|suppose|let)/i.test(answer);

  if (words < 15) {
    return { score: 1, feedback: 'Very short answer. Add full proof details.' };
  }
  if (words < 40) {
    return { score: 3, feedback: 'Decent start but needs clearer argument and justification.' };
  }
  if (words < 90 || !hasStructure) {
    return { score: 5, feedback: 'Good core idea. Improve structure and rigor for full marks.' };
  }

  return { score: 6, feedback: 'Strong explanation. Minor polishing could reach 7/7.' };
}

async function gradeWithOpenAI(answer, apiKey, problem) {
  const prompt = [
    'You are grading an olympiad-style proof solution.',
    'Give a strict score from 0 to 7 and one short feedback sentence.',
    `Problem: ${problem.title}. ${problem.statement}`,
    `Student solution: ${answer}`,
    'Output JSON only: {"score": number, "feedback": "text"}'
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: prompt
    })
  });

  if (!response.ok) {
    throw new Error('API request failed');
  }

  const data = await response.json();
  const outputText = data.output_text || '{}';
  const parsed = JSON.parse(outputText);

  const bounded = Math.max(0, Math.min(7, Number(parsed.score) || 0));
  return {
    score: bounded,
    feedback: parsed.feedback || 'AI grading complete.'
  };
}

async function handleSubmit() {
  const answer = solutionInput.value.trim();
  const username = localStorage.getItem(STORAGE_KEYS.user);
  const problem = window.DAILY_PROBLEMS[todayKey];

  if (!username) {
    submitFeedback.textContent = 'Choose a username first.';
    userModal.classList.add('visible');
    return;
  }

  if (!problem) {
    submitFeedback.textContent = 'No problem available today.';
    return;
  }

  if (!answer) {
    submitFeedback.textContent = 'Write a solution before submitting.';
    return;
  }

  submitBtn.disabled = true;
  submitFeedback.textContent = 'Grading...';

  let result = estimateScoreLocally(answer);
  const apiKey = apiKeyInput.value.trim();

  if (apiKey) {
    try {
      result = await gradeWithOpenAI(answer, apiKey, problem);
    } catch (error) {
      submitFeedback.textContent = 'AI grading failed, used local rubric fallback.';
    }
  }

  const submissions = getStoredSubmissions();
  if (!submissions[todayKey]) {
    submissions[todayKey] = [];
  }

  const elapsedSeconds = getElapsedFromMidnight();
  submissions[todayKey].push({
    user: username,
    score: result.score,
    feedback: result.feedback,
    elapsedSeconds,
    submittedAt: new Date().toISOString(),
    problemCode: problem.code
  });

  saveSubmissions(submissions);
  submitFeedback.textContent = `Submitted: ${result.score}/7 • ${result.feedback}`;
  submitBtn.disabled = false;

  renderLeaderboard();
  renderCalendar();
  renderStreak();
}

function renderLeaderboard() {
  const submissions = getStoredSubmissions();
  const todays = submissions[todayKey] || [];

  const bestByUser = {};
  todays.forEach((entry) => {
    const existing = bestByUser[entry.user];
    if (!existing || entry.score > existing.score || (entry.score === existing.score && entry.elapsedSeconds < existing.elapsedSeconds)) {
      bestByUser[entry.user] = entry;
    }
  });

  const rows = Object.values(bestByUser)
    .sort((a, b) => b.score - a.score || a.elapsedSeconds - b.elapsedSeconds)
    .slice(0, 12);

  leaderboardList.innerHTML = '';

  if (!rows.length) {
    leaderboardList.innerHTML = '<p class="empty-text">No submissions yet today.</p>';
    return;
  }

  rows.forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'leaderboard-entry';

    if (index === 0) row.classList.add('first');
    if (index === 1) row.classList.add('second');
    if (index === 2) row.classList.add('third');

    row.innerHTML = `
      <span class="rank">#${index + 1}</span>
      <span class="user">${entry.user}</span>
      <span class="score">${formatElapsed(entry.elapsedSeconds)} • ${entry.score}/7</span>
    `;

    leaderboardList.appendChild(row);
  });
}

function renderCalendar() {
  const monthName = now.toLocaleString(undefined, { month: 'long' });
  calendarTitle.textContent = `${monthName} ${currentYear}`;

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const submissions = getStoredSubmissions();

  calendarGrid.innerHTML = '';

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(currentYear, currentMonth, day);
    const key = getDateKey(date);
    const cell = document.createElement('div');

    cell.className = 'day';
    cell.textContent = String(day);

    if (day === now.getDate()) {
      cell.classList.add('today');
    } else if (date < new Date(currentYear, currentMonth, now.getDate())) {
      cell.classList.add('past');
    } else {
      cell.classList.add('future');
    }

    if ((submissions[key] || []).length > 0) {
      cell.classList.add('solved');
    }

    calendarGrid.appendChild(cell);
  }
}

function renderStreak() {
  const submissions = getStoredSubmissions();
  const username = localStorage.getItem(STORAGE_KEYS.user);

  if (!username) {
    streakCount.textContent = '0';
    return;
  }

  let streak = 0;

  for (let i = 0; i < 365; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = getDateKey(date);
    const dayEntries = submissions[key] || [];

    const hasUserSubmission = dayEntries.some((entry) => entry.user === username);
    if (!hasUserSubmission) {
      break;
    }

    streak += 1;
  }

  streakCount.textContent = String(streak);
}

profileIcon.addEventListener('click', () => {
  profileMenu.style.display = profileMenu.style.display === 'block' ? 'none' : 'block';
});

document.addEventListener('click', (event) => {
  if (!profileIcon.contains(event.target)) {
    profileMenu.style.display = 'none';
  }
});

changeUserBtn.addEventListener('click', (event) => {
  event.preventDefault();
  userModal.classList.add('visible');
  userModal.setAttribute('aria-hidden', 'false');
});

userForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = userNameInput.value.trim();
  if (name.length < 2) {
    return;
  }
  setUser(name);
  userNameInput.value = '';
});

submitBtn.addEventListener('click', handleSubmit);

ensureUser();
renderTodayProblem();
renderLeaderboard();
renderCalendar();
renderStreak();
