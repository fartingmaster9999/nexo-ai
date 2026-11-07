import { useEffect } from 'react';
import {
  VideoCanvas,
  VideoPausedContext,
  type VideoAspectRatio,
  useVideoPlayer,
} from '@/lib/video';
import { AnimatePresence } from 'framer-motion';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';

export const SCENE_DURATIONS = {
  signal: 2500,
  agent: 4000,
  logo: 3000,
  reveal: 6500,
};

export const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';

const SCENE_COMPONENTS = [Scene1, Scene2, Scene3, Scene4];
const SCENE_KEYS = Object.keys(SCENE_DURATIONS);

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  paused = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  paused?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentScene, currentSceneKey } = useVideoPlayer({
    durations,
    loop,
    paused,
  });
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const baseSceneIndex = SCENE_KEYS.indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneIndex];

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas
        aspectRatio={VIDEO_ASPECT_RATIO}
        className="nexo-grain"
        style={{ backgroundColor: 'var(--nexo-ink)' }}
      >
        <div className="absolute inset-0 overflow-hidden">
          <AnimatePresence mode="sync">
            {SceneComponent && (
              <SceneComponent key={currentSceneKey} sceneIndex={currentScene} />
            )}
          </AnimatePresence>
        </div>
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
