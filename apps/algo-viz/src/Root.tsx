import React from "react";
import { Composition } from "remotion";
import { ALGO_VIZ_REGISTRY } from "./registry";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {Object.values(ALGO_VIZ_REGISTRY).map((entry) => (
        <Composition
          key={entry.id}
          id={entry.id}
          component={entry.component}
          durationInFrames={entry.durationInFrames}
          fps={entry.fps}
          width={entry.width}
          height={entry.height}
          defaultProps={entry.defaultProps}
        />
      ))}
    </>
  );
};
