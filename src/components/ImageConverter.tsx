import React, { useState, useCallback } from 'react';
import { UploadCloud, CheckCircle, AlertTriangle, Download, X, Loader2, Settings } from 'lucide-react';
import { Card } from '@heroui/react';
import { Button } from '@heroui/react';
import { Select, ListBox } from '@heroui/react';
import { Label } from '@heroui/react';
import { Slider } from '@heroui/react';
import { Checkbox } from '@heroui/react';
import { Spinner } from '@heroui/react';
import { cn } from '@/lib/utils';
import imageCompression from 'browser-image-compression';

type ConversionStatus = 'pending' | 'converting' | 'success' | 'error';
type GlobalMessage = { type: 'success' | 'error' | 'warning' | 'info' | ''; text: string };
type FileFormat = 'png' | 'jpeg' | 'webp' | 'pdf';
type InputFilter = 'all' | 'image' | FileFormat;

const ImageConverter = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [conversionStatus, setConversionStatus] = useState<Record<string, ConversionStatus>>({});
  const [isConverting, setIsConverting] = useState(false);
  const [globalMessage, setGlobalMessage] = useState<GlobalMessage>({ type: '', text: '' });
  
  const [inputFilter, setInputFilter] = useState<InputFilter>('all');
  const [outputFormat, setOutputFormat] = useState<FileFormat>('webp');

  // Compression settings
  const [enableCompression, setEnableCompression] = useState(false);
  const [compressionQuality, setCompressionQuality] = useState([0.8]);
  const [maxSizeMB, setMaxSizeMB] = useState(1);
  const [maxWidth, setMaxWidth] = useState(1920);
  const [maxHeight, setMaxHeight] = useState(1920);

  const withRetry = async <T,>(fn: () => Promise<T>, maxRetries = 3, delay = 100): Promise<T> => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
    throw new Error("Retry failed");
  };

  const getAcceptedFileTypes = (filter: InputFilter): string => {
    switch (filter) {
      case 'all': return '.png, .jpg, .jpeg, .webp, .pdf, image/png, image/jpeg, image/webp, application/pdf';
      case 'image': return '.png, .jpg, .jpeg, .webp, image/png, image/jpeg, image/webp';
      case 'pdf': return '.pdf, application/pdf';
      case 'png': return '.png, image/png';
      case 'jpeg': return '.jpg, .jpeg, image/jpeg';
      case 'webp': return '.webp, image/webp';
      default: return '';
    }
  };

  // Compress image using browser-image-compression
  const compressImage = async (file: File): Promise<File> => {
    if (!enableCompression || !file.type.startsWith('image/')) {
      return file;
    }

    const options = {
      maxSizeMB: maxSizeMB,
      maxWidthOrHeight: Math.max(maxWidth, maxHeight),
      useWebWorker: true,
      quality: compressionQuality[0],
      fileType: file.type,
    };

    try {
      const compressedFile = await imageCompression(file, options);
      return compressedFile;
    } catch (error) {
      console.error('Compression failed, using original file:', error);
      return file;
    }
  };

  // Convert Image -> Image (Canvas)
  const convertImageToImage = (file: File, format: FileFormat): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error("Canvas context failed");
            ctx.drawImage(img, 0, 0);
            
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error("Conversion failed"));
            }, `image/${format}`, compressionQuality[0]);
          } catch (err) { reject(err); }
        };
        img.onerror = () => reject(new Error("Failed to load image"));
        if (typeof e.target?.result === 'string') img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  };

  // Convert Image -> PDF
  const convertImageToPdf = async (file: File): Promise<Blob> => {
    // Dynamic import to avoid SSR issues
    const { PDFDocument } = await import('pdf-lib');
    
    const pdfDoc = await PDFDocument.create();
    let imageBytes = await file.arrayBuffer();
    let imageEmbed;

    // pdf-lib supports PNG and JPG directly. For WebP, convert to PNG first.
    if (file.type === 'image/webp' || file.name.endsWith('.webp')) {
        const pngBlob = await convertImageToImage(file, 'png');
        imageBytes = await pngBlob.arrayBuffer();
        imageEmbed = await pdfDoc.embedPng(imageBytes);
    } else if (file.type === 'image/jpeg' || file.name.endsWith('.jpg') || file.name.endsWith('.jpeg')) {
        imageEmbed = await pdfDoc.embedJpg(imageBytes);
    } else {
        // Assume PNG fallback
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
    return new Blob([pdfBytes], { type: 'application/pdf' });
  };

  // Convert PDF -> Image (All Pages)
  const convertPdfToImage = async (file: File, format: FileFormat): Promise<Blob[]> => {
    // Dynamic import to avoid SSR issues
    const pdfjsLib = await import('pdfjs-dist');
    // Set worker source using unpkg to match version dynamically if possible, or use a reliable CDN
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const imageBlobs: Blob[] = [];

    // Convert each page
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      
      const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better quality
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      const context = canvas.getContext('2d');
      if (!context) throw new Error("Canvas context failed");

      await page.render({ canvasContext: context, viewport: viewport }).promise;

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error(`PDF page ${pageNum} conversion failed`));
        }, `image/${format}`, compressionQuality[0]);
      });

      imageBlobs.push(blob);
    }

    return imageBlobs;
  };

  const convertFile = async (file: File, targetFormat: FileFormat): Promise<Blob | Blob[]> => {
    const isInputPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isOutputPdf = targetFormat === 'pdf';

    // Compress image first if enabled and it's an image
    let fileToProcess = file;
    if (!isInputPdf && enableCompression) {
      fileToProcess = await compressImage(file);
    }

    if (isInputPdf && isOutputPdf) {
        // PDF -> PDF: Return original (or could compress/process)
        return file; 
    } else if (isInputPdf && !isOutputPdf) {
        // PDF -> Image (returns array of blobs, one per page)
        return convertPdfToImage(file, targetFormat);
    } else if (!isInputPdf && isOutputPdf) {
        // Image -> PDF
        return convertImageToPdf(fileToProcess);
    } else {
        // Image -> Image
        return convertImageToImage(fileToProcess, targetFormat);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGlobalMessage({ type: '', text: '' });
    if (!event.target.files) return;
    
    // Manual filter double-check
    const acceptedTypes = getAcceptedFileTypes(inputFilter).split(',').map(t => t.trim());
    const newFiles = Array.from(event.target.files).filter(file => {
        // Simple extension/MIME check
        if (inputFilter === 'all') return true; // Accept what the input accepted
        // More strict checks could go here
        return true;
    });

    setFiles(prev => [...prev, ...newFiles]);
    setConversionStatus(prev => ({
        ...prev,
        ...Object.fromEntries(newFiles.map(f => [f.name, 'pending' as ConversionStatus]))
    }));

    event.target.value = '';
  };

  const downloadFile = (blob: Blob, originalFileName: string, format: FileFormat, pageNumber?: number) => {
    const nameWithoutExt = originalFileName.substring(0, originalFileName.lastIndexOf('.')) || originalFileName;
    const pageSuffix = pageNumber !== undefined ? `_page${pageNumber}` : '';
    const newFileName = `${nameWithoutExt}${pageSuffix}.${format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
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
    setGlobalMessage({ type: 'info', text: `Starting conversion for ${files.length} files...` });

    let successfulConversions = 0;
    let failedConversions = 0;

    for (const file of files) {
      const fileName = file.name;
      setConversionStatus(prev => ({ ...prev, [fileName]: 'converting' }));

      try {
        await withRetry(async () => {
          const convertedResult = await convertFile(file, outputFormat);
          
          // Handle PDF -> Image (returns array of blobs)
          if (Array.isArray(convertedResult)) {
            convertedResult.forEach((blob, index) => {
              downloadFile(blob, fileName, outputFormat, index + 1);
            });
            successfulConversions += convertedResult.length;
          } else {
            // Handle single blob result (Image -> Image, Image -> PDF, etc.)
            downloadFile(convertedResult, fileName, outputFormat);
            successfulConversions++;
          }
        });

        setConversionStatus(prev => ({ ...prev, [fileName]: 'success' }));
      } catch (error) {
        console.error(`Conversion failed for ${fileName}:`, error);
        setConversionStatus(prev => ({ ...prev, [fileName]: 'error' }));
        failedConversions++;
      }
    }

    setIsConverting(false);

    if (failedConversions === 0) {
      setGlobalMessage({
        type: 'success',
        text: `Batch conversion complete! Successfully converted ${successfulConversions} file(s).`
      });
    } else {
      setGlobalMessage({
        type: 'error',
        text: `Conversion finished with ${successfulConversions} success(es) and ${failedConversions} failure(s).`
      });
    }
  };

  const removeFile = useCallback((fileNameToRemove: string) => {
    setFiles(prevFiles => prevFiles.filter(f => f.name !== fileNameToRemove));
    setConversionStatus(prevStatus => {
      const newStatus = { ...prevStatus };
      delete newStatus[fileNameToRemove];
      return newStatus;
    });

    if (files.length <= 1) {
        setGlobalMessage({ type: '', text: '' });
    }
  }, [files.length]);

  const getStatusVisuals = (status: ConversionStatus) => {
    switch (status) {
      case 'pending':
        return { color: 'text-muted-foreground', icon: <UploadCloud className="w-5 h-5" /> };
      case 'converting':
        return { color: 'text-blue-500', icon: <Loader2 className="w-5 h-5 animate-spin" /> };
      case 'success':
        return { color: 'text-green-500', icon: <CheckCircle className="w-5 h-5" /> };
      case 'error':
        return { color: 'text-destructive', icon: <AlertTriangle className="w-5 h-5" /> };
      default:
        return { color: 'text-muted-foreground', icon: <div className="w-5 h-5"></div> };
    }
  };

  const totalFiles = files.length;
  const isButtonDisabled = totalFiles === 0 || isConverting;

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Main Content */}
        <div className="flex-1">
          <Card className="shadow-xl">
            <Card.Header>
              <Card.Title className="text-3xl font-extrabold text-center">Batch Format Converter</Card.Title>
              <Card.Description className="text-center">
                  Convert Images to PDF, PDF to Images, and between Image formats locally.
              </Card.Description>
            </Card.Header>
            <Card.Content className="space-y-6">
              
              {globalMessage.text && (
                <div className={cn(
                  "p-3 rounded-lg font-medium text-sm border",
                  globalMessage.type === 'success' ? 'bg-green-100 text-green-700 border-green-200' :
                  globalMessage.type === 'error' ? 'bg-red-100 text-red-700 border-red-200' :
                  globalMessage.type === 'warning' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                  'bg-blue-100 text-blue-700 border-blue-200'
                )}>
                  {globalMessage.text}
                </div>
              )}

              {/* Controls */}
              <div className="flex flex-col md:flex-row gap-4">
                  
                  {/* Input Filter */}
                   <div className="w-full md:w-48 space-y-2">
                      <Select 
                        value={inputFilter}
                        onChange={(value) => setInputFilter(value as InputFilter)}
                        placeholder="Select input"
                      >
                          <Label>Convert From</Label>
                          <Select.Trigger>
                              <Select.Value />
                              <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                              <ListBox>
                                  <ListBox.Item id="all" textValue="All Supported">
                                      All Supported
                                      <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                  <ListBox.Item id="image" textValue="All Images">
                                      All Images
                                      <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                  <ListBox.Item id="pdf" textValue="PDF Only">
                                      PDF Only
                                      <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                  <ListBox.Item id="png" textValue="PNG Only">
                                      PNG Only
                                      <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                  <ListBox.Item id="jpeg" textValue="JPEG Only">
                                      JPEG Only
                                      <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                  <ListBox.Item id="webp" textValue="WebP Only">
                                      WebP Only
                                      <ListBox.ItemIndicator />
                                  </ListBox.Item>
                              </ListBox>
                          </Select.Popover>
                      </Select>
                  </div>

                  {/* Output Format */}
                  <div className="w-full md:w-48 space-y-2">
                      <Select 
                        value={outputFormat}
                        onChange={(value) => setOutputFormat(value as FileFormat)}
                        placeholder="Select output"
                      >
                          <Label>Convert To</Label>
                          <Select.Trigger>
                              <Select.Value />
                              <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                              <ListBox>
                                  <ListBox.Item id="webp" textValue="WebP Image">
                                      WebP Image
                                      <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                  <ListBox.Item id="png" textValue="PNG Image">
                                      PNG Image
                                      <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                  <ListBox.Item id="jpeg" textValue="JPEG Image">
                                      JPEG Image
                                      <ListBox.ItemIndicator />
                                  </ListBox.Item>
                                  <ListBox.Item id="pdf" textValue="PDF Document">
                                      PDF Document
                                      <ListBox.ItemIndicator />
                                  </ListBox.Item>
                              </ListBox>
                          </Select.Popover>
                      </Select>
                  </div>
              </div>

              {/* Upload Area */}
              <Label htmlFor="file-upload" className="cursor-pointer block">
                  <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-input rounded-lg hover:bg-accent/50 transition-colors">
                      <UploadCloud className="w-10 h-10 text-primary mb-3" />
                      <p className="text-lg font-semibold">Click to upload or drag & drop</p>
                      <p className="text-sm text-muted-foreground mt-1">
                          {inputFilter === 'pdf' ? 'PDF files only' : 
                           inputFilter === 'image' ? 'Images (PNG, JPG, WebP)' : 
                           'Images or PDF files'}
                      </p>
                  </div>
                  <input
                      id="file-upload"
                      type="file"
                      multiple
                      accept={getAcceptedFileTypes(inputFilter)}
                      onChange={handleFileChange}
                      className="hidden"
                  />
              </Label>

              {/* File List */}
              {totalFiles > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-muted/50 p-3 border-b flex justify-between items-center">
                      <h3 className="font-semibold text-sm">Files Queue ({totalFiles})</h3>
                      <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 text-destructive hover:text-destructive"
                          onPress={() => { setFiles([]); setConversionStatus({}); }}
                      >
                          Clear All
                      </Button>
                  </div>
                  <ul className="max-h-64 overflow-y-auto divide-y">
                    {files.map((file, idx) => {
                      const status = conversionStatus[file.name] || 'pending';
                      const { color, icon } = getStatusVisuals(status);

                      return (
                        <li
                          key={file.name + idx}
                          className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-center space-x-3 overflow-hidden">
                            <span className={color}>{icon}</span>
                            <div className="flex flex-col min-w-0">
                                <span className="truncate text-sm font-medium">
                                  {file.name}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {(file.size / 1024 / 1024).toFixed(2)} MB
                                </span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 flex-shrink-0">
                              <span className={cn("text-xs font-medium capitalize hidden sm:inline-block", color)}>
                                  {status === 'converting' ? 'Converting...' : status}
                              </span>
                              <Button
                                  variant="ghost"
                                  isIconOnly
                                  size="sm"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onPress={() => removeFile(file.name)}
                                  isDisabled={isConverting}
                              >
                                  <X className="w-4 h-4" />
                                  <span className="sr-only">Remove file</span>
                              </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

            </Card.Content>
            <Card.Footer className="flex justify-center pb-8">
              <Button
                  onPress={startConversion}
                  isDisabled={isButtonDisabled}
                  size="lg"
                  isPending={isConverting}
                  className="w-full sm:w-auto min-w-[200px]"
              >
                  {({ isPending }) => (
                    <>
                      {isPending ? (
                        <>
                          <Spinner size="sm" color="current" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Download className="mr-2 h-4 w-4" />
                          Convert & Download ({totalFiles})
                        </>
                      )}
                    </>
                  )}
              </Button>
            </Card.Footer>
          </Card>
        </div>

        {/* Right Panel - Compression Settings */}
        <div className="w-full lg:w-80 flex-shrink-0">
          <Card className="shadow-xl">
            <Card.Header>
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                <Card.Title className="text-xl">Compression Settings</Card.Title>
              </div>
              <Card.Description>
                Configure image compression options
              </Card.Description>
            </Card.Header>
            <Card.Content className="space-y-6">
              {/* Enable Compression Toggle */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="enable-compression"
                  isSelected={enableCompression}
                  onChange={setEnableCompression}
                >
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                </Checkbox>
                <Label
                  htmlFor="enable-compression"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Enable Compression
                </Label>
              </div>

              {enableCompression && (
                <>
                  {/* Quality Slider */}
                  <div className="space-y-2">
                    <Slider
                      id="quality"
                      minValue={0.1}
                      maxValue={1}
                      step={0.05}
                      value={compressionQuality[0]}
                      onChange={(value) => setCompressionQuality([typeof value === 'number' ? value : value[0]])}
                      isDisabled={!enableCompression}
                      className="w-full"
                    >
                      <div className="flex justify-between items-center">
                        <Label htmlFor="quality">Quality</Label>
                        <Slider.Output>
                          {({ state }) => (
                            <span className="text-sm text-muted-foreground">
                              {Math.round(state.values[0] * 100)}%
                            </span>
                          )}
                        </Slider.Output>
                      </div>
                      <Slider.Track>
                        <Slider.Fill />
                        <Slider.Thumb />
                      </Slider.Track>
                    </Slider>
                    <p className="text-xs text-muted-foreground">
                      Lower = smaller file size, lower quality
                    </p>
                  </div>

                  {/* Max File Size */}
                  <div className="space-y-2">
                    <Label htmlFor="max-size">Max File Size (MB)</Label>
                    <input
                      id="max-size"
                      type="number"
                      min={0.1}
                      max={10}
                      step={0.1}
                      value={maxSizeMB}
                      onChange={(e) => setMaxSizeMB(parseFloat(e.target.value) || 1)}
                      disabled={!enableCompression}
                      className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background disabled:opacity-50"
                    />
                    <p className="text-xs text-muted-foreground">
                      Target maximum file size
                    </p>
                  </div>

                  {/* Max Width */}
                  <div className="space-y-2">
                    <Label htmlFor="max-width">Max Width (px)</Label>
                    <input
                      id="max-width"
                      type="number"
                      min={100}
                      max={5000}
                      step={100}
                      value={maxWidth}
                      onChange={(e) => setMaxWidth(parseInt(e.target.value) || 1920)}
                      disabled={!enableCompression}
                      className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background disabled:opacity-50"
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum image width
                    </p>
                  </div>

                  {/* Max Height */}
                  <div className="space-y-2">
                    <Label htmlFor="max-height">Max Height (px)</Label>
                    <input
                      id="max-height"
                      type="number"
                      min={100}
                      max={5000}
                      step={100}
                      value={maxHeight}
                      onChange={(e) => setMaxHeight(parseInt(e.target.value) || 1920)}
                      disabled={!enableCompression}
                      className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background disabled:opacity-50"
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum image height
                    </p>
                  </div>
                </>
              )}
            </Card.Content>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ImageConverter;
