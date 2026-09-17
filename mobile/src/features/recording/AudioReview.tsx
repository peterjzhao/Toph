import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { ArrowDownToLine, AudioLines, Pause, Play } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import type { RecordingAudio } from "./local-drafts";
import { clock } from "./recording-utils";
import { colors, fonts, shared, fontSize, lineHeight, radius, spacing } from "./styles";

type Props = { audio: RecordingAudio; seconds: number; isDemo: boolean; title?: string; fileName: string; onError: (message: string) => void };

/** Mirrors the web app's audio review card: title, duration, download (share) action, and a player. */
export default function AudioReview({ audio, seconds, isDemo, title, fileName, onError }: Props) {
  const player = useAudioPlayer({ uri: audio.uri }, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);
  const [sharing, setSharing] = useState(false);
  const duration = status.duration > 0 ? status.duration : seconds;
  const position = Math.min(status.currentTime, duration);
  const progress = duration > 0 ? position / duration : 0;

  useEffect(() => {
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  }, []);

  function toggle() {
    if (status.playing) { player.pause(); return; }
    if (duration > 0 && position >= duration - 0.05) player.seekTo(0);
    player.play();
  }

  function seek(x: number) {
    if (!trackWidth || !duration) return;
    player.seekTo(Math.max(0, Math.min(duration, (x / trackWidth) * duration)));
  }

  async function share() {
    if (sharing) return;
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is unavailable on this device.");
      const target = new File(Paths.cache, fileName);
      if (target.exists) target.delete();
      if (audio.uri.startsWith("https://")) await File.downloadFileAsync(audio.uri, target);
      else new File(audio.uri).copy(target);
      await Sharing.shareAsync(target.uri, { mimeType: audio.mimeType, UTI: "public.mpeg-4-audio", dialogTitle: "Save recording" });
    } catch (cause) {
      onError(cause instanceof Error && cause.message ? cause.message : "The recording could not be shared.");
    } finally {
      setSharing(false);
    }
  }

  return <View style={styles.card}>
    <View style={styles.heading}>
      <AudioLines size={18} color={colors.ink} />
      <Text style={styles.title}>{title ?? (isDemo ? "Sample recording" : "Recording")}</Text>
      <Text style={styles.duration}>{clock(seconds)}</Text>
      <Pressable style={[styles.share, sharing ? shared.disabled : null]} onPress={share} disabled={sharing} accessibilityRole="button" accessibilityLabel="Download recording">
        <ArrowDownToLine size={18} color={colors.muted} />
      </Pressable>
    </View>
    <View style={styles.player} accessibilityLabel="Review recording">
      <Pressable style={styles.playButton} onPress={toggle} accessibilityRole="button" accessibilityLabel={status.playing ? "Pause" : "Play"}>
        {status.playing ? <Pause size={18} color={colors.ink} fill={colors.ink} strokeWidth={0} /> : <Play size={18} color={colors.ink} fill={colors.ink} strokeWidth={0} />}
      </Pressable>
      <Text style={styles.time}>{clock(position)}</Text>
      <Pressable style={styles.track} onLayout={(event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width)} onPress={(event) => seek(event.nativeEvent.locationX)} accessibilityRole="adjustable" accessibilityLabel="Playback position">
        <View style={styles.trackLine}><View style={[styles.trackFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
      </Pressable>
      <Text style={styles.time}>{clock(duration)}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.popover, paddingTop: 10, paddingHorizontal: spacing.sm, paddingBottom: 14 },
  heading: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginBottom: spacing.xs },
  title: { fontFamily: fonts.medium, fontSize: fontSize.body, lineHeight: lineHeight.body, color: colors.ink },
  duration: { marginLeft: "auto", fontFamily: fonts.regular, fontSize: fontSize.caption, lineHeight: lineHeight.caption, color: colors.muted, fontVariant: ["tabular-nums"] },
  share: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  player: { flexDirection: "row", alignItems: "center", gap: 10, height: 38 },
  playButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.line },
  time: { fontFamily: fonts.regular, fontSize: fontSize.caption, lineHeight: lineHeight.caption, color: colors.muted, fontVariant: ["tabular-nums"], minWidth: 38, textAlign: "center" },
  track: { flex: 1, height: 38, justifyContent: "center" },
  trackLine: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  trackFill: { height: 4, backgroundColor: colors.green },
});
