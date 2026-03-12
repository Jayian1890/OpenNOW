import type { JSX } from "react";

interface ButtonProps {
  className?: string;
  size?: number;
}

export function ButtonA({ className, size = 18 }: ButtonProps): JSX.Element {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      className={className}
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" stroke="#58d98a" strokeWidth="2.5" fill="rgba(88, 217, 138, 0.1)" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="12" fontWeight="900" fill="#58d98a" fontFamily="Inter, system-ui">A</text>
    </svg>
  );
}

export function ButtonB({ className, size = 18 }: ButtonProps): JSX.Element {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      className={className}
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="2.5" fill="rgba(239, 68, 68, 0.1)" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="12" fontWeight="900" fill="#ef4444" fontFamily="Inter, system-ui">B</text>
    </svg>
  );
}

export function ButtonX({ className, size = 18 }: ButtonProps): JSX.Element {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      className={className}
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" stroke="#3b82f6" strokeWidth="2.5" fill="rgba(59, 130, 246, 0.1)" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="12" fontWeight="900" fill="#3b82f6" fontFamily="Inter, system-ui">X</text>
    </svg>
  );
}

export function ButtonY({ className, size = 18 }: ButtonProps): JSX.Element {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      className={className}
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" stroke="#eab308" strokeWidth="2.5" fill="rgba(234, 179, 8, 0.1)" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="12" fontWeight="900" fill="#eab308" fontFamily="Inter, system-ui">Y</text>
    </svg>
  );
}
