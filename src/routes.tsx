import { Navigate, type RouteObject } from "react-router";
import Home from "./pages/Home";
import AirAdviceDemo from "./pages/AirAdviceDemo";
import TeacherGate from "./pages/TeacherGate";
import { ClassroomDemo, StudentClassroom } from "./pages/Classroom";
import { STUDENT_PATH } from "./lib/classroom";

// Every page of the app is listed here, and only here. main.tsx builds the router from this
// array and exposes it as window.__baze.routes so the BAZE preview can list the pages.
// App (src/App.tsx) is the shell around every page; it renders the current page in <Outlet />.
// A page only the owner opens carries handle: { owner: true }: the preview's page list groups it
// apart from the visitor pages. The owner layer is in src/owner/ (src/owner/OWNER.md).
export const routes: RouteObject[] = [
  { path: "/", element: <Home />, children: [
    { index: true, element: <></> },
    { path: "demo/air", element: <AirAdviceDemo /> },
    { path: "teacher", element: <TeacherGate /> },
    { path: "teacher/co2", element: <TeacherGate key="classroom" mode="classroom" /> },
  ] },
  { path: STUDENT_PATH, element: <StudentClassroom /> },
  { path: "/demo/co2", element: <ClassroomDemo /> },
  { path: "*", element: <Navigate to="/" replace /> },
];
