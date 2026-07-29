import React from "react";
import { Composition } from "remotion";
import { PpoClip, PPO_CLIP_DURATION, PPO_CLIP_FPS, PPO_CLIP_HEIGHT, PPO_CLIP_WIDTH } from "./compositions/PpoClip";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PpoClip"
        component={PpoClip}
        durationInFrames={PPO_CLIP_DURATION}
        fps={PPO_CLIP_FPS}
        width={PPO_CLIP_WIDTH}
        height={PPO_CLIP_HEIGHT}
        defaultProps={{
          epsilon: 0.2,
          title: "PPO-Clip：信任域的一阶近似",
        }}
      />
    </>
  );
};
