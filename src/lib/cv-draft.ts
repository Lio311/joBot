// Free (no AI) questionnaire draft from the CV text: known titles and skills found in it.

import { hasTerm } from "./match";
import type { ProfileAnswers } from "./profile";

export const TITLES = [
  "Data Analyst", "Data Scientist", "Data Engineer", "BI Developer", "BI Analyst", "Business Analyst", "Product Analyst",
  "Backend Developer", "Backend Engineer", "Frontend Developer", "Frontend Engineer", "Full Stack Developer", "Fullstack Developer",
  "Software Engineer", "Software Developer", "DevOps Engineer", "Site Reliability Engineer", "Cloud Engineer", "Platform Engineer",
  "QA Engineer", "QA Automation Engineer", "Automation Engineer", "Mobile Developer", "iOS Developer", "Android Developer",
  "Machine Learning Engineer", "ML Engineer", "AI Engineer", "Algorithm Engineer", "Algorithm Developer", "Computer Vision Engineer",
  "Product Manager", "Product Owner", "Project Manager", "Program Manager", "Technical Writer", "UX Designer", "UI Designer",
  "Product Designer", "Security Researcher", "Security Engineer", "Cyber Security Analyst", "SOC Analyst", "Penetration Tester",
  "Solutions Engineer", "Sales Engineer", "Customer Success Manager", "Support Engineer", "IT Administrator", "System Administrator",
  "Network Engineer", "Embedded Engineer", "Hardware Engineer", "Firmware Engineer", "Data Architect", "Solution Architect",
  "Team Lead", "Tech Lead", "Engineering Manager", "Marketing Analyst", "Financial Analyst", "Operations Analyst",
];

export const SKILLS = [
  "SQL", "Python", "R", "Excel", "VBA", "Tableau", "Power BI", "Looker", "Qlik", "dbt", "Airflow", "Spark", "PySpark", "Hadoop", "Kafka",
  "Snowflake", "BigQuery", "Redshift", "Databricks", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Pandas", "NumPy",
  "Scikit-learn", "TensorFlow", "PyTorch", "Keras", "NLP", "LLM", "Machine Learning", "Deep Learning", "Statistics", "A/B Testing",
  "ETL", "Data Modeling", "Data Warehouse", "AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins",
  "GitHub Actions", "CI/CD", "Linux", "Bash", "Git", "Java", "Kotlin", "Scala", "Go", "Golang", "Rust", "C", "C++", "C#", ".NET",
  "JavaScript", "TypeScript", "Node.js", "React", "Next.js", "Angular", "Vue", "HTML", "CSS", "GraphQL", "REST", "Microservices",
  "Django", "Flask", "FastAPI", "Spring", "Swift", "Objective-C", "Flutter", "React Native", "Selenium", "Cypress", "Playwright",
  "Jira", "Figma", "Salesforce", "SAP", "Hubspot", "Google Analytics", "Mixpanel", "Amplitude", "MATLAB", "SIEM", "Splunk",
  "Networking", "Penetration Testing", "Agile", "Scrum",
];

export function draftLocally(cv: string): Partial<ProfileAnswers> {
  const text = cv.toLowerCase();
  const roles = TITLES.filter((t) => hasTerm(text, t)).slice(0, 6);
  const skills = SKILLS.filter((s) => (s.length <= 2 ? new RegExp(`(^|[^a-z+#])${s.toLowerCase()}(?=$|[^a-z+#])`).test(text) : hasTerm(text, s)));
  // "3 years of experience" / "3 שנות ניסיון" written in the CV itself.
  const yrs = [...cv.matchAll(/(\d{1,2})\+?\s*(?:years|שנות|שנים)/gi)].map((m) => +m[1]).filter((n) => n > 0 && n < 40);
  const languages = ["עברית", "English", "Русский", "العربية", "Français", "Español"].filter((l, i) =>
    [/hebrew|עברית/i, /english|אנגלית/i, /russian|רוסית/i, /arabic|ערבית/i, /french|צרפתית/i, /spanish|ספרדית/i][i].test(cv),
  );
  return {
    roles,
    skills: skills.slice(0, 15),
    niceSkills: skills.slice(15, 25),
    yearsExperience: yrs.length ? Math.max(...yrs) : null,
    languages,
  };
}
