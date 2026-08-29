import { createBrowserRouter } from "react-router";
import { SplashScreen } from "./components/SplashScreen";
import { PatientDashboard } from "./components/PatientDashboard";
import { TherapySession } from "./components/TherapySession";
import { CaregiverReport } from "./components/CaregiverReport";
import { Layout } from "./components/Layout";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: SplashScreen },
      { path: "dashboard", Component: PatientDashboard },
      { path: "therapy", Component: TherapySession },
      { path: "report", Component: CaregiverReport },
    ],
  },
]);
