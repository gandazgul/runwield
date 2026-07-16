// @ts-nocheck: Workspace React UI is the scoped TypeScript/TSX exception zone.

import { AnnotationPanel } from "@plannotator/ui/components/AnnotationPanel.tsx";
import { RemoteCommentStateList } from "./RemoteCommentStateList.jsx";

export function RemoteCommentPanel(
    { comments, annotations, blocks, selectedId, closed, pendingId, onSelect, onResolve, onReopen },
) {
    const byAnnotationId = new Map(comments.map((comment) => [comment.id, comment]));
    const orderedComments = annotations.map((annotation) => byAnnotationId.get(annotation.id)).filter(Boolean);
    return (
        <aside className="rw-remote-annotation-sidebar" aria-label="Remote review annotations">
            <div className="rw-remote-annotation-panel">
                <AnnotationPanel
                    isOpen
                    annotations={annotations}
                    blocks={blocks}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onDelete={() => {}}
                    sharingEnabled={false}
                    width="100%"
                />
            </div>
            <RemoteCommentStateList
                comments={orderedComments}
                selectedId={selectedId}
                closed={closed}
                pendingId={pendingId}
                onSelect={onSelect}
                onResolve={onResolve}
                onReopen={onReopen}
            />
        </aside>
    );
}
