export function StateText({ text }: { text: string }) {
  const parts = text.split(/(Unknown|Unresolved|Unavailable|Unobserved|Blocked)/g);
  return (
    <>
      {parts.filter((part) => part !== "").map((part, index) => {
        if (part === "Unknown") return <span key={index} className="state-unknown">Unknown</span>;
        if (part === "Unresolved") return <span key={index} className="state-unresolved">Unresolved</span>;
        if (part === "Unavailable") return <span key={index} className="state-unavailable">Unavailable</span>;
        if (part === "Unobserved") return <span key={index} className="state-unobserved">Unobserved</span>;
        if (part === "Blocked") return <span key={index} className="state-blocked">Blocked</span>;
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}
