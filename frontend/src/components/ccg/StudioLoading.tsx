import { FaSpinner } from "react-icons/fa6";
import styles from "./studio.module.css";

export default function StudioLoading({ label }: { label?: string }) {
  return <div className={styles.pageLoading} role="status" aria-busy="true">
    <FaSpinner className={styles.spinner} aria-hidden="true" />{label && <span>{label}</span>}
  </div>;
}
