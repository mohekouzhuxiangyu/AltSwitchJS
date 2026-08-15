using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

// 从 1024x1024 PNG 生成多尺寸 ICO（PNG 压缩格式，Vista+ 支持）
public class IcoGen
{
    static Bitmap Resize(Bitmap src, int size)
    {
        Bitmap b = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(b))
        {
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.DrawImage(src, 0, 0, size, size);
        }
        return b;
    }

    static byte[] ToPngBytes(Bitmap b)
    {
        using (MemoryStream ms = new MemoryStream())
        {
            b.Save(ms, ImageFormat.Png);
            return ms.ToArray();
        }
    }

    public static void Main(string[] args)
    {
        // args: 源png 输出ico
        string src = args[0];
        string dst = args[1];
        int[] sizes = { 16, 24, 32, 48, 64, 128, 256 };

        using (Bitmap srcBmp = new Bitmap(src))
        {
            List<byte[]> datas = new List<byte[]>();
            List<int> usedSizes = new List<int>();
            foreach (int s in sizes)
            {
                using (Bitmap r = Resize(srcBmp, s))
                {
                    datas.Add(ToPngBytes(r));
                    usedSizes.Add(s);
                }
            }

            int count = usedSizes.Count;
            int headerSize = 6 + 16 * count;
            using (FileStream fs = new FileStream(dst, FileMode.Create))
            using (BinaryWriter w = new BinaryWriter(fs))
            {
                w.Write((ushort)0);          // reserved
                w.Write((ushort)1);          // type: icon
                w.Write((ushort)count);      // count
                int offset = headerSize;
                for (int i = 0; i < count; i++)
                {
                    int s = usedSizes[i];
                    w.Write((byte)(s >= 256 ? 0 : s)); // width (0=256)
                    w.Write((byte)(s >= 256 ? 0 : s)); // height
                    w.Write((byte)0);                  // colors
                    w.Write((byte)0);                  // reserved
                    w.Write((ushort)1);                // planes
                    w.Write((ushort)32);               // bitcount
                    w.Write((int)datas[i].Length);     // size
                    w.Write((int)offset);              // offset
                    offset += datas[i].Length;
                }
                for (int i = 0; i < count; i++)
                    w.Write(datas[i]);
            }
        }
        Console.WriteLine("ICO written: " + dst);
    }
}
