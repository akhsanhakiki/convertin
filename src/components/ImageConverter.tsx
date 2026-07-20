import React, { useState, useCallback, useRef } from "react";
import imageCompression from "browser-image-compression";

type ConversionStatus = "pending" | "converting" | "success" | "error";
type GlobalMessage = { type: "success" | "error" | "info" | ""; text: string };
type FileFormat = "png" | "jpeg" | "webp" | "pdf";
type InputFilter = "all" | "image" | FileFormat;

const ImageConverter = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [conversionStatus, setConversionStatus] = useState<
    Record<string, ConversionStatus>
  >({});
  const [isConverting, setIsConverting] = useState(false);
  const [globalMessage, setGlobalMessage] = useState<GlobalMessage>({
    type: "",
    text: "",
  });
  const [dragActive, setDragActive] = useState(false);

  const [inputFilter, setInputFilter] = useState<InputFilter>("all");
  const [outputFormat, setOutputFormat] = useState<FileFormat>("webp");

  const [enableCompression, setEnableCompression] = useState(false);
  const [compressionQuality, setCompressionQuality] = useState(0.8);
  const [maxSizeMB, setMaxSizeMB] = useState(1);
  const [maxWidth, setMaxWidth] = useState(1920);
  const [maxHeight, setMaxHeight] = useState(1920);

  const inputRef = useRef<HTMLInputElement>(null);

  const withRetry = async <T,>(
    fn: () => Promise<T>,
    maxRetries = 3,
    delay = 100,
  ): Promise<T> => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, delay * Math.pow(2, i)),
        );
      }
    }
    throw new Error("Retry failed");
  };

  const getAcceptedFileTypes = (filter: InputFilter): string => {
    switch (filter) {
      case "all":
        return ".png, .jpg, .jpeg, .webp, .pdf, image/png, image/jpeg, image/webp, application/pdf";
      case "image":
        return ".png, .jpg, .jpeg, .webp, image/png, image/jpeg, image/webp";
      case "pdf":
        return ".pdf, application/pdf";
      case "png":
        return ".png, image/png";
      case "jpeg":
        return ".jpg, .jpeg, image/jpeg";
      case "webp":
        return ".webp, image/webp";
      default:
        return "";
    }
  };

  const getDropHint = (filter: InputFilter): string => {
    switch (filter) {
      case "pdf":
        return "PDF ONLY";
      case "image":
        return "PNG · JPG · WEBP";
      case "png":
        return "PNG ONLY";
      case "jpeg":
        return "JPEG ONLY";
      case "webp":
        return "WEBP ONLY";
      default:
        return "IMAGES OR PDF";
    }
  };

  const compressImage = async (file: File): Promise<File> => {
    if (!enableCompression || !file.type.startsWith("image/")) {
      return file;
    }

    try {
      return await imageCompression(file, {
        maxSizeMB,
        maxWidthOrHeight: Math.max(maxWidth, maxHeight),
        useWebWorker: true,
        quality: compressionQuality,
        fileType: file.type,
      });
    } catch {
      return file;
    }
  };

  const convertImageToImage = (
    file: File,
    format: FileFormat,
  ): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas context failed");
            ctx.drawImage(img, 0, 0);

            canvas.toBlob(
              (blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Conversion failed"));
              },
              `image/${format}`,
              compressionQuality,
            );
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        if (typeof e.target?.result === "string") img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  };

  const convertImageToPdf = async (file: File): Promise<Blob> => {
    const { PDFDocument } = await import("pdf-lib");

    const pdfDoc = await PDFDocument.create();
    let imageBytes = await file.arrayBuffer();
    let imageEmbed;

    if (file.type === "image/webp" || file.name.endsWith(".webp")) {
      const pngBlob = await convertImageToImage(file, "png");
      imageBytes = await pngBlob.arrayBuffer();
      imageEmbed = await pdfDoc.embedPng(imageBytes);
    } else if (
      file.type === "image/jpeg" ||
      file.name.endsWith(".jpg") ||
      file.name.endsWith(".jpeg")
    ) {
      imageEmbed = await pdfDoc.embedJpg(imageBytes);
    } else {
      imageEmbed = await pdfDoc.embedPng(imageBytes);
    }

    const page = pdfDoc.addPage([imageEmbed.width, imageEmbed.height]);
    page.drawImage(imageEmbed, {
      x: 0,
      y: 0,
      width: imageEmbed.width,
      height: imageEmbed.height,
    });

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: "application/pdf" });
  };

  const convertPdfToImage = async (
    file: File,
    format: FileFormat,
  ): Promise<Blob[]> => {
    const pdfjsLib = await import("pdfjs-dist");
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const imageBlobs: Blob[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context failed");

      await page.render({ canvasContext: context, viewport }).promise;

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) resolve(b);
            else reject(new Error(`PDF page ${pageNum} conversion failed`));
          },
          `image/${format}`,
          compressionQuality,
        );
      });

      imageBlobs.push(blob);
    }

    return imageBlobs;
  };

  const convertFile = async (
    file: File,
    targetFormat: FileFormat,
  ): Promise<Blob | Blob[]> => {
    const isInputPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");
    const isOutputPdf = targetFormat === "pdf";

    let fileToProcess = file;
    if (!isInputPdf && enableCompression) {
      fileToProcess = await compressImage(file);
    }

    if (isInputPdf && isOutputPdf) {
      return file;
    } else if (isInputPdf && !isOutputPdf) {
      return convertPdfToImage(file, targetFormat);
    } else if (!isInputPdf && isOutputPdf) {
      return convertImageToPdf(fileToProcess);
    } else {
      return convertImageToImage(fileToProcess, targetFormat);
    }
  };

  const addFiles = (incoming: FileList | File[]) => {
    setGlobalMessage({ type: "", text: "" });
    const newFiles = Array.from(incoming);
    if (newFiles.length === 0) return;

    setFiles((prev) => [...prev, ...newFiles]);
    setConversionStatus((prev) => ({
      ...prev,
      ...Object.fromEntries(
        newFiles.map((f) => [f.name, "pending" as ConversionStatus]),
      ),
    }));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return;
    addFiles(event.target.files);
    event.target.value = "";
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files?.length) {
      addFiles(event.dataTransfer.files);
    }
  };

  const downloadFile = (
    blob: Blob,
    originalFileName: string,
    format: FileFormat,
    pageNumber?: number,
  ) => {
    const nameWithoutExt =
      originalFileName.substring(0, originalFileName.lastIndexOf(".")) ||
      originalFileName;
    const pageSuffix = pageNumber !== undefined ? `_page${pageNumber}` : "";
    const newFileName = `${nameWithoutExt}${pageSuffix}.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = newFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const startConversion = async () => {
    if (files.length === 0 || isConverting) return;

    setIsConverting(true);
    setGlobalMessage({
      type: "info",
      text: `Converting ${files.length} file(s)…`,
    });

    let successfulConversions = 0;
    let failedConversions = 0;

    for (const file of files) {
      const fileName = file.name;
      setConversionStatus((prev) => ({ ...prev, [fileName]: "converting" }));

      try {
        await withRetry(async () => {
          const convertedResult = await convertFile(file, outputFormat);

          if (Array.isArray(convertedResult)) {
            convertedResult.forEach((blob, index) => {
              downloadFile(blob, fileName, outputFormat, index + 1);
            });
            successfulConversions += convertedResult.length;
          } else {
            downloadFile(convertedResult, fileName, outputFormat);
            successfulConversions++;
          }
        });

        setConversionStatus((prev) => ({ ...prev, [fileName]: "success" }));
      } catch {
        setConversionStatus((prev) => ({ ...prev, [fileName]: "error" }));
        failedConversions++;
      }
    }

    setIsConverting(false);

    if (failedConversions === 0) {
      setGlobalMessage({
        type: "success",
        text: `Done. ${successfulConversions} file(s) downloaded.`,
      });
    } else {
      setGlobalMessage({
        type: "error",
        text: `${successfulConversions} ok, ${failedConversions} failed.`,
      });
    }
  };

  const removeFile = useCallback(
    (fileNameToRemove: string) => {
      setFiles((prevFiles) =>
        prevFiles.filter((f) => f.name !== fileNameToRemove),
      );
      setConversionStatus((prevStatus) => {
        const next = { ...prevStatus };
        delete next[fileNameToRemove];
        return next;
      });

      if (files.length <= 1) {
        setGlobalMessage({ type: "", text: "" });
      }
    },
    [files.length],
  );

  const totalFiles = files.length;
  const isButtonDisabled = totalFiles === 0 || isConverting;

  return (
    <div className="cv">
      <div className="cv__body">
        {globalMessage.text && (
          <div
            className={`cv__alert cv__alert--${globalMessage.type || "info"}`}
            role="status"
          >
            <span className="cv__alert-mark" aria-hidden="true" />
            <span>{globalMessage.text}</span>
          </div>
        )}

        <div className="cv__formats">
          <div>
            <label className="cv__label" htmlFor="input-filter">
              FROM
            </label>
            <select
              id="input-filter"
              className="cv__select"
              value={inputFilter}
              onChange={(e) => setInputFilter(e.target.value as InputFilter)}
            >
              <option value="all">All Supported</option>
              <option value="image">All Images</option>
              <option value="pdf">PDF Only</option>
              <option value="png">PNG Only</option>
              <option value="jpeg">JPEG Only</option>
              <option value="webp">WebP Only</option>
            </select>
          </div>

          <div>
            <label className="cv__label" htmlFor="output-format">
              TO
            </label>
            <select
              id="output-format"
              className="cv__select"
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as FileFormat)}
            >
              <option value="webp">WebP</option>
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
              <option value="pdf">PDF</option>
            </select>
          </div>
        </div>

        <div>
          <span className="cv__label">FILES</span>
          <div
            className={`cv__drop${dragActive ? " cv__drop--active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <div className="cv__drop-icon" aria-hidden="true">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 3v12" />
                <path d="M8 7l4-4 4 4" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </div>
            <p className="cv__drop-title">TAP OR DROP FILES</p>
            <p className="cv__drop-hint">{getDropHint(inputFilter)}</p>
            {totalFiles > 0 && (
              <p className="cv__drop-count">
                {totalFiles} READY
              </p>
            )}
            <input
              ref={inputRef}
              id="file-upload"
              type="file"
              multiple
              accept={getAcceptedFileTypes(inputFilter)}
              onChange={handleFileChange}
              className="sr-only"
            />
          </div>
        </div>

        {totalFiles > 0 && (
          <div>
            <div className="cv__queue-head">
              <h2 className="cv__queue-title">QUEUE ({totalFiles})</h2>
              <button
                type="button"
                className="cv__btn cv__btn--ghost cv__btn--ghost-danger"
                onClick={() => {
                  setFiles([]);
                  setConversionStatus({});
                  setGlobalMessage({ type: "", text: "" });
                }}
                disabled={isConverting}
              >
                CLEAR
              </button>
            </div>
            <div className="cv__queue">
              {files.map((file, idx) => {
                const status = conversionStatus[file.name] || "pending";
                return (
                  <div className="cv__file" key={`${file.name}-${idx}`}>
                    <span
                      className={`cv__file-status cv__file-status--${status}`}
                      aria-hidden="true"
                    />
                    <div className="cv__file-info">
                      <span className="cv__file-name">{file.name}</span>
                      <div className="cv__file-meta">
                        <span>
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </span>
                        <span>·</span>
                        <span>
                          {status === "converting" ? "Converting" : status}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="cv__btn--icon"
                      onClick={() => removeFile(file.name)}
                      disabled={isConverting}
                      aria-label={`Remove ${file.name}`}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <details className="cv__settings">
        <summary>
          <span>COMPRESSION{enableCompression ? " · ON" : ""}</span>
          <span className="cv__settings-chevron" aria-hidden="true" />
        </summary>
        <div className="cv__settings-body">
          <label className="cv__check">
            <input
              type="checkbox"
              checked={enableCompression}
              onChange={(e) => setEnableCompression(e.target.checked)}
            />
            <span>
              <span className="cv__check-title">Enable compression</span>
              <p className="cv__check-hint">
                Shrink images before convert. Tune quality below.
              </p>
            </span>
          </label>

          {enableCompression && (
            <>
              <div className="cv__field">
                <div className="cv__field-row">
                  <label
                    className="cv__label"
                    htmlFor="quality"
                    style={{ margin: 0 }}
                  >
                    QUALITY
                  </label>
                  <span className="cv__value">
                    {Math.round(compressionQuality * 100)}%
                  </span>
                </div>
                <input
                  id="quality"
                  className="cv__range"
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={compressionQuality}
                  onChange={(e) =>
                    setCompressionQuality(parseFloat(e.target.value))
                  }
                />
                <p className="cv__hint">LOWER = SMALLER FILE</p>
              </div>

              <div className="cv__field">
                <label className="cv__label" htmlFor="max-size">
                  MAX SIZE (MB)
                </label>
                <input
                  id="max-size"
                  className="cv__number"
                  type="number"
                  inputMode="decimal"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={maxSizeMB}
                  onChange={(e) =>
                    setMaxSizeMB(parseFloat(e.target.value) || 1)
                  }
                />
              </div>

              <div className="cv__dims">
                <div className="cv__field">
                  <label className="cv__label" htmlFor="max-width">
                    MAX W
                  </label>
                  <input
                    id="max-width"
                    className="cv__number"
                    type="number"
                    inputMode="numeric"
                    min={100}
                    max={5000}
                    step={100}
                    value={maxWidth}
                    onChange={(e) =>
                      setMaxWidth(parseInt(e.target.value, 10) || 1920)
                    }
                  />
                </div>
                <div className="cv__field">
                  <label className="cv__label" htmlFor="max-height">
                    MAX H
                  </label>
                  <input
                    id="max-height"
                    className="cv__number"
                    type="number"
                    inputMode="numeric"
                    min={100}
                    max={5000}
                    step={100}
                    value={maxHeight}
                    onChange={(e) =>
                      setMaxHeight(parseInt(e.target.value, 10) || 1920)
                    }
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </details>

      <div className="cv__actions">
        <button
          type="button"
          className="cv__btn cv__btn--full"
          onClick={startConversion}
          disabled={isButtonDisabled}
        >
          {isConverting
            ? "PROCESSING…"
            : totalFiles > 0
              ? `CONVERT (${totalFiles})`
              : "CONVERT"}
        </button>
      </div>
    </div>
  );
};

export default ImageConverter;
