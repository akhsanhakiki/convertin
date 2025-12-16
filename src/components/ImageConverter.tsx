import React, { useState, useCallback } from 'react';
import { UploadCloud, CheckCircle, AlertTriangle, Download, X, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type ConversionStatus = 'pending' | 'converting' | 'success' | 'error';
type GlobalMessage = { type: 'success' | 'error' | 'warning' | 'info' | ''; text: string };
type OutputFormat = 'webp' | 'png' | 'jpeg';

const ImageConverter = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [conversionStatus, setConversionStatus] = useState<Record<string, ConversionStatus>>({});
  const [isConverting, setIsConverting] = useState(false);
  const [globalMessage, setGlobalMessage] = useState<GlobalMessage>({ type: '', text: '' });
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('webp');

  const acceptedMimeTypes = ['image/png', 'image/jpeg', 'image/webp'];

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

  const convertFile = useCallback((file: File, format: OutputFormat) => {
    return new Promise<Blob>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error("Failed to get canvas context"));
                return;
            }
            ctx.drawImage(img, 0, 0, img.width, img.height);

            const mimeType = `image/${format}`;
            canvas.toBlob((blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error(`Browser failed to export as ${format}.`));
              }
            }, mimeType, 0.95);

          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error('Failed to load image into memory.'));
        if (typeof e.target?.result === 'string') {
            img.src = e.target.result;
        } else {
             reject(new Error('Failed to read file data.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file from disk.'));
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGlobalMessage({ type: '', text: '' });
    if (!event.target.files) return;
    
    const selectedFiles = Array.from(event.target.files).filter(file => acceptedMimeTypes.includes(file.type));

    setFiles(prev => [...prev, ...selectedFiles]);
    setConversionStatus(prev => ({
        ...prev,
        ...Object.fromEntries(selectedFiles.map(f => [f.name, 'pending' as ConversionStatus]))
    }));

    if (selectedFiles.length === 0 && event.target.files.length > 0) {
      setGlobalMessage({
        type: 'warning',
        text: 'Some files were skipped. Only PNG, JPG, and WebP files are supported.'
      });
    }
    event.target.value = '';
  };

  const downloadFile = (blob: Blob, originalFileName: string, format: OutputFormat) => {
    const nameWithoutExt = originalFileName.substring(0, originalFileName.lastIndexOf('.')) || originalFileName;
    const newFileName = `${nameWithoutExt}.${format}`;
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
    setGlobalMessage({ type: 'info', text: `Starting conversion for ${files.length} images to ${outputFormat.toUpperCase()}...` });

    let successfulConversions = 0;
    let failedConversions = 0;

    for (const file of files) {
      const fileName = file.name;
      // Skip if already successfully converted in this batch? No, user might want to reconvert.
      // But maybe we should only convert 'pending' or reset status. 
      // For now, convert all in list.
      setConversionStatus(prev => ({ ...prev, [fileName]: 'converting' }));

      try {
        await withRetry(async () => {
          const convertedBlob = await convertFile(file, outputFormat);
          downloadFile(convertedBlob, fileName, outputFormat);
          successfulConversions++;
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
    <Card className="w-full max-w-4xl mx-auto shadow-xl">
      <CardHeader>
        <CardTitle className="text-3xl font-extrabold text-center">Batch Image Converter</CardTitle>
        <CardDescription className="text-center">
            Convert PNG, JPG, and WebP images locally in your browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        
        {/* Global Message Alert */}
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

        {/* Controls: File Upload & Output Format */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-end">
            <div className="flex-1">
                <Label htmlFor="file-upload" className="cursor-pointer">
                    <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-input rounded-lg hover:bg-accent/50 transition-colors">
                        <UploadCloud className="w-10 h-10 text-primary mb-3" />
                        <p className="text-lg font-semibold">Click to upload or drag & drop</p>
                        <p className="text-sm text-muted-foreground mt-1">PNG, JPG, WebP (up to 10MB)</p>
                    </div>
                    <input
                        id="file-upload"
                        type="file"
                        multiple
                        accept=".png, .jpg, .jpeg, .webp, image/png, image/jpeg, image/webp"
                        onChange={handleFileChange}
                        className="hidden"
                    />
                </Label>
            </div>
            
            <div className="w-full md:w-48 space-y-2">
                <Label>Output Format</Label>
                <Select value={outputFormat} onValueChange={(v: OutputFormat) => setOutputFormat(v)}>
                    <SelectTrigger>
                        <SelectValue placeholder="Select format" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="webp">WebP</SelectItem>
                        <SelectItem value="png">PNG</SelectItem>
                        <SelectItem value="jpeg">JPEG</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>

        {/* File List */}
        {totalFiles > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/50 p-3 border-b flex justify-between items-center">
                <h3 className="font-semibold text-sm">Files to Convert ({totalFiles})</h3>
                <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-8 text-destructive hover:text-destructive"
                    onClick={() => { setFiles([]); setConversionStatus({}); }}
                >
                    Clear All
                </Button>
            </div>
            <ul className="max-h-64 overflow-y-auto divide-y">
              {files.map((file) => {
                const status = conversionStatus[file.name] || 'pending';
                const { color, icon } = getStatusVisuals(status);

                return (
                  <li
                    key={file.name + file.size} // better key if names duplicate?
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
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeFile(file.name)}
                            disabled={isConverting}
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

      </CardContent>
      <CardFooter className="flex justify-center pb-8">
        <Button
            onClick={startConversion}
            disabled={isButtonDisabled}
            size="lg"
            className="w-full sm:w-auto min-w-[200px]"
        >
            {isConverting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Converting...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Convert & Download ({totalFiles})
              </>
            )}
        </Button>
      </CardFooter>
    </Card>
  );
};

export default ImageConverter;

