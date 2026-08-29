import React from "react";
import "./BrandPreviewSurface.css";

export function BrandPreviewSurface(): React.JSX.Element {
  return (
    <section className="yance-brand-preview" aria-label="言策品牌预览">
      <svg className="yance-brand-preview__mark" viewBox="0 0 256 256" aria-hidden="true">
        <rect width="256" height="256" rx="58" fill="#2A0F4A" />
        <path d="M67 72h122c13 0 23 10 23 23v56c0 13-10 23-23 23h-60l-41 31v-31H67c-13 0-23-10-23-23V95c0-13 10-23 23-23Z" fill="none" stroke="#FFFFFF" strokeWidth="15" strokeLinejoin="round" />
        <path d="m86 142 33-32 25 22 34-37" fill="none" stroke="#FFFFFF" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <strong>言策 <span>YANCE</span></strong>
        <p>深紫与白色是当前生产品牌权威。</p>
      </div>
    </section>
  );
}
