"use client";
import { useRef } from "react";

export default function Example() {
  const count = useRef(0);

  const handleClick = () => {
    count.current += 1;

    console.log(count.current);
  };

  return (
    <button onClick={handleClick}>
      Increase
    </button>
  );
}