// 1. Connect to Supabase (the address and the public visitor pass)
const SUPABASE_URL = "https://zlsiagmjsdzvrogbxbla.supabase.co";
const SUPABASE_KEY = "sb_publishable_gz62g0665YZA-kR2iNYAGQ_TB4ACOe4";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// 2. Grab things from the page
const fileInput = document.getElementById("studentFile");
const readMessage = document.getElementById("readMessage");
const tableBody = document.getElementById("studentTable");
const saveBtn = document.getElementById("saveBtn");
const message = document.getElementById("message");

const codeBox = document.getElementById("courseCode");
const nameBox = document.getElementById("courseName");
const sectionBox = document.getElementById("courseSection");
const semesterBox = document.getElementById("courseSemester");
const instructorBox = document.getElementById("courseInstructor");

let students = []; // the basket for students found in the file

// 3. When a file is chosen: read it, find students and course details
fileInput.addEventListener("change", async function () {
  const file = fileInput.files[0];
  if (!file) {
    return;
  }

  readMessage.textContent = "Reading file...";
  message.textContent = "";
  tableBody.innerHTML = "";
  students = [];

  try {
    const rows = await readAnyFile(file);     // parser.js: file -> rows
    students = extractStudents(rows);          // parser.js: rows -> students
    const course = extractCourse(rows);        // parser.js: rows -> course details

    codeBox.value = course.code;
    nameBox.value = course.name;
    sectionBox.value = course.section;
    semesterBox.value = course.semester;
    instructorBox.value = course.instructor;

    students.forEach(function (student, index) {
      const row = document.createElement("tr");
      [index + 1, student.roll_no, student.name].forEach(function (value) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      tableBody.appendChild(row);
    });

    if (students.length === 0) {
      readMessage.textContent =
        "No students found. Check that the file has roll numbers like 25014198-001 and names.";
    } else {
      readMessage.textContent =
        "Found " + students.length + " students. Check them, then save.";
    }
  } catch (error) {
    readMessage.textContent = "Could not read the file: " + error.message;
  }
});

// 4. When Save is clicked: save course, students, and who is in the course
saveBtn.addEventListener("click", async function () {
  if (students.length === 0) {
    message.textContent = "Please choose a file with students first.";
    return;
  }

  const course = {
    code: codeBox.value.trim(),
    name: nameBox.value.trim(),
    section: sectionBox.value.trim(),
    semester: semesterBox.value.trim(),
    instructor: instructorBox.value.trim() || null
  };

  if (!course.code || !course.name || !course.section || !course.semester) {
    message.textContent = "Please fill in course code, name, section and semester.";
    return;
  }

  message.textContent = "Saving...";

  // a) Save the course (or find it, if it is already saved)
  const courseResult = await db
    .from("courses")
    .upsert(course, { onConflict: "code,section,semester" })
    .select()
    .single();
  if (courseResult.error) {
    message.textContent = "Error saving course: " + courseResult.error.message;
    return;
  }

  // b) Save the students
  const studentResult = await db
    .from("students")
    .upsert(students, { onConflict: "roll_no" })
    .select("id, roll_no");
  if (studentResult.error) {
    message.textContent = "Error saving students: " + studentResult.error.message;
    return;
  }

  // c) Link every student to this course
  const links = studentResult.data.map(function (s) {
    return { course_id: courseResult.data.id, student_id: s.id };
  });
  const linkResult = await db
    .from("enrollments")
    .upsert(links, { onConflict: "course_id,student_id" });
  if (linkResult.error) {
    message.textContent = "Error linking students: " + linkResult.error.message;
    return;
  }

  message.textContent =
    "Saved " + students.length + " students in " + course.code +
    " (section " + course.section + ").";
});
