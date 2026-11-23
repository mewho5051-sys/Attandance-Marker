// 1. Connect to Supabase (same address and visitor pass as before)
const SUPABASE_URL = "https://zlsiagmjsdzvrogbxbla.supabase.co";
const SUPABASE_KEY = "sb_publishable_gz62g0665YZA-kR2iNYAGQ_TB4ACOe4";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. Grab things from the page
const courseSelect = document.getElementById("courseSelect");
const sessionDate = document.getElementById("sessionDate");
const startTime = document.getElementById("startTime");
const endTime = document.getElementById("endTime");
const createBtn = document.getElementById("createBtn");
const sessionMessage = document.getElementById("sessionMessage");
const sessionSelect = document.getElementById("sessionSelect");
const markSection = document.getElementById("markSection");
const attendanceBody = document.getElementById("attendanceBody");
const allPresentBtn = document.getElementById("allPresentBtn");
const allAbsentBtn = document.getElementById("allAbsentBtn");
const summary = document.getElementById("summary");
const saveBtn = document.getElementById("saveBtn");
const message = document.getElementById("message");

let enrolled = [];   // students in the chosen course
let sessions = [];   // sessions of the chosen course

// Today's date in YYYY-MM-DD, using the computer's own clock
function today() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + month + "-" + day;
}
sessionDate.value = today();

// 3. Load the list of courses into the dropdown
async function loadCourses() {
  const result = await db.from("courses").select("*").order("code");
  if (result.error) {
    sessionMessage.textContent = "Error loading courses: " + result.error.message;
    return;
  }

  courseSelect.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = result.data.length === 0
    ? "No courses yet. Upload a list first."
    : "-- choose a course --";
  courseSelect.appendChild(first);

  result.data.forEach(function (c) {
    const option = document.createElement("option");
    option.value = c.id;
    option.textContent =
      c.code + " " + c.name + " (section " + c.section + ", " + c.semester + ")";
    courseSelect.appendChild(option);
  });
}

// 4. When a course is chosen, load its students and its sessions
courseSelect.addEventListener("change", async function () {
  markSection.hidden = true;
  sessionMessage.textContent = "";
  enrolled = [];
  sessions = [];
  fillSessionList(null);

  const courseId = courseSelect.value;
  if (!courseId) {
    return;
  }

  // Students of this course (the enrollments table links students to courses)
  const studentResult = await db
    .from("enrollments")
    .select("students(id, roll_no, name)")
    .eq("course_id", courseId);
  if (studentResult.error) {
    sessionMessage.textContent = "Error loading students: " + studentResult.error.message;
    return;
  }
  enrolled = studentResult.data
    .map(function (row) { return row.students; })
    .sort(function (a, b) { return a.roll_no.localeCompare(b.roll_no); });

  if (enrolled.length === 0) {
    sessionMessage.textContent = "No students in this course yet. Upload the list first.";
    return;
  }

  await loadSessions(courseId, null);
});

// 5. Load the sessions of a course into the second dropdown
async function loadSessions(courseId, selectId) {
  const result = await db
    .from("sessions")
    .select("*")
    .eq("course_id", courseId)
    .order("session_date", { ascending: false })
    .order("start_time", { ascending: false });
  if (result.error) {
    sessionMessage.textContent = "Error loading sessions: " + result.error.message;
    return;
  }
  sessions = result.data;
  fillSessionList(selectId);

  if (selectId) {
    await showMarking(selectId);
  }
}

function fillSessionList(selectId) {
  sessionSelect.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = "-- choose a session --";
  sessionSelect.appendChild(first);

  sessions.forEach(function (s) {
    const option = document.createElement("option");
    option.value = s.id;
    option.textContent =
      s.session_date + ", " + s.start_time.slice(0, 5) + " to " + s.end_time.slice(0, 5);
    sessionSelect.appendChild(option);
  });

  if (selectId) {
    sessionSelect.value = String(selectId);
  }
}

// 6. Create a new session (one lecture on one day)
createBtn.addEventListener("click", async function () {
  const courseId = courseSelect.value;
  if (!courseId) {
    sessionMessage.textContent = "Please choose a course first.";
    return;
  }
  if (enrolled.length === 0) {
    sessionMessage.textContent = "This course has no students yet.";
    return;
  }
  if (!sessionDate.value || !startTime.value || !endTime.value) {
    sessionMessage.textContent = "Please set the date, start time and end time.";
    return;
  }
  if (endTime.value <= startTime.value) {
    sessionMessage.textContent = "The end time must be after the start time.";
    return;
  }

  // Do not make the same lecture twice
  const same = sessions.find(function (s) {
    return s.session_date === sessionDate.value &&
           s.start_time.slice(0, 5) === startTime.value;
  });
  if (same) {
    sessionMessage.textContent = "This session already exists. Opening it.";
    sessionSelect.value = String(same.id);
    await showMarking(same.id);
    return;
  }

  sessionMessage.textContent = "Creating session...";
  const result = await db
    .from("sessions")
    .insert({
      course_id: courseId,
      session_date: sessionDate.value,
      start_time: startTime.value,
      end_time: endTime.value
    })
    .select()
    .single();
  if (result.error) {
    sessionMessage.textContent = "Error creating session: " + result.error.message;
    return;
  }

  sessionMessage.textContent = "Session created. Now mark the students below.";
  await loadSessions(courseId, result.data.id);
});

// 7. When a session is chosen from the list, show the marking table
sessionSelect.addEventListener("change", async function () {
  if (!sessionSelect.value) {
    markSection.hidden = true;
    return;
  }
  await showMarking(sessionSelect.value);
});

// Make one radio button (Present, Absent or Late)
function makeChoice(studentId, value, label, checked) {
  const wrapper = document.createElement("label");
  wrapper.className = "choice";

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "status-" + studentId;
  radio.value = value;
  radio.checked = checked;
  radio.addEventListener("change", updateSummary);

  wrapper.appendChild(radio);
  wrapper.appendChild(document.createTextNode(" " + label));
  return wrapper;
}

// Build the table of students for one session
async function showMarking(sessionId) {
  message.textContent = "";

  // If attendance was saved before for this session, load it
  const result = await db
    .from("attendance")
    .select("student_id, status")
    .eq("session_id", sessionId);
  if (result.error) {
    message.textContent = "Error loading attendance: " + result.error.message;
    return;
  }
  const saved = {};
  result.data.forEach(function (r) { saved[r.student_id] = r.status; });

  attendanceBody.innerHTML = "";
  enrolled.forEach(function (student, index) {
    const status = saved[student.id] || "present";
    const row = document.createElement("tr");

    [index + 1, student.roll_no, student.name].forEach(function (value) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });

    const choiceCell = document.createElement("td");
    choiceCell.appendChild(makeChoice(student.id, "present", "Present", status === "present"));
    choiceCell.appendChild(makeChoice(student.id, "absent", "Absent", status === "absent"));
    choiceCell.appendChild(makeChoice(student.id, "late", "Late", status === "late"));
    row.appendChild(choiceCell);

    attendanceBody.appendChild(row);
  });

  markSection.hidden = false;
  updateSummary();
}

// Count how many are present, absent and late
function updateSummary() {
  const present = document.querySelectorAll('#attendanceBody input[value="present"]:checked').length;
  const absent = document.querySelectorAll('#attendanceBody input[value="absent"]:checked').length;
  const late = document.querySelectorAll('#attendanceBody input[value="late"]:checked').length;
  summary.textContent =
    "Present: " + present + "   Absent: " + absent + "   Late: " + late +
    "   Total: " + enrolled.length;
}

// 8. Quick buttons
function markAll(value) {
  document.querySelectorAll('#attendanceBody input[value="' + value + '"]').forEach(function (radio) {
    radio.checked = true;
  });
  updateSummary();
}
allPresentBtn.addEventListener("click", function () { markAll("present"); });
allAbsentBtn.addEventListener("click", function () { markAll("absent"); });

// 9. Save attendance to the database
saveBtn.addEventListener("click", async function () {
  const sessionId = sessionSelect.value;
  if (!sessionId) {
    message.textContent = "Please choose a session first.";
    return;
  }

  const rows = enrolled.map(function (student) {
    const checked = document.querySelector('input[name="status-' + student.id + '"]:checked');
    return {
      session_id: sessionId,
      student_id: student.id,
      status: checked ? checked.value : "present"
    };
  });

  message.textContent = "Saving...";
  const result = await db
    .from("attendance")
    .upsert(rows, { onConflict: "session_id,student_id" });

  if (result.error) {
    message.textContent = "Error saving attendance: " + result.error.message;
  } else {
    message.textContent = "Attendance saved for " + rows.length + " students.";
  }
});

// Start: load the courses
loadCourses();
