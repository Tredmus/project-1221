/** Serializable reference chart state from the server (signed URL + alignment). */
export interface MapEditorReferenceServerProps {
  signedUrl: string | null;
  panX: number;
  panY: number;
  scale: number;
  opacity: number;
}
