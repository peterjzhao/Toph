import { Image, StyleSheet, Text, View } from "react-native";
import { assetUrl } from "@/lib/api/demo-client";
import { colors, fonts } from "./styles";
export default function ProfileAvatar({ name, uri, size = 40 }: { name: string; uri?: string | null; size?: number }) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  return uri ? <Image source={{ uri: assetUrl(uri)! }} style={shape} accessibilityLabel={`${name} profile photo`} accessibilityIgnoresInvertColors /> :
    <View style={[styles.initials, shape]}><Text style={{ fontFamily: fonts.medium, color: colors.ink, fontSize: size * 0.34 }}>{name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase()}</Text></View>;
}
const styles = StyleSheet.create({ initials: { alignItems: "center", justifyContent: "center", backgroundColor: colors.line } });
