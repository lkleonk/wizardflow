import { Fragment } from "react";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";

type LoadNoticesProps = {
  uploadNoticeOpen: boolean;
  onCloseUploadNotice: () => void;
  exampleErrorOpen: boolean;
  onCloseExampleError: () => void;
};

// The two toasts a flow load can raise. They share the demo toast's anchor
// slot, and none of the three can overlap: loading a file clears the demo
// toast, and an upload and a failed example fetch are different actions.
export default function LoadNotices({
  uploadNoticeOpen,
  onCloseUploadNotice,
  exampleErrorOpen,
  onCloseExampleError,
}: LoadNoticesProps) {
  return (
    <Fragment>
      {/* Load feedback for user files, doubling as the privacy reassurance
          right after the moment of doubt. Same anchor slot as the demo toast;
          the two can't overlap since loading a file clears the demo toast. */}
      <Snackbar
        open={uploadNoticeOpen}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        autoHideDuration={6000}
        onClose={onCloseUploadNotice}
        sx={{ top: { xs: 104, sm: 76 } }}
      >
        <Alert
          severity="success"
          onClose={onCloseUploadNotice}
          sx={{ maxWidth: 480 }}
        >
          Trace loaded. Processed locally; nothing was sent to a server.
        </Alert>
      </Snackbar>

      {/* Example traces are fetched on demand, so unlike an upload they can
          fail — offline, or a redeploy that renamed the chunk under a tab that
          has been open across it. Either way a reload fixes it. */}
      <Snackbar
        open={exampleErrorOpen}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        autoHideDuration={6000}
        onClose={onCloseExampleError}
        sx={{ top: { xs: 104, sm: 76 } }}
      >
        <Alert
          severity="error"
          onClose={onCloseExampleError}
          sx={{ maxWidth: 480 }}
        >
          Couldn&apos;t load that example. Check your connection and try again,
          or reload the page.
        </Alert>
      </Snackbar>
    </Fragment>
  );
}
