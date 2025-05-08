import { ActionFunction, json } from "@remix-run/node";
import { authenticate } from "app/shopify.server";

/**
 * Action function xử lý POST request để thêm đánh giá
 */
export const action: ActionFunction = async ({ request }) => {
  console.log("test action authenticate.");
  try {
    const { admin } = await authenticate.public.appProxy(request);

    if (!admin) {
      throw new Error("Không thể xác thực với Shopify Admin API");
    }

    const formData = await request.formData();
    const rating = parseInt(formData.get("rating") as string);
    const author = formData.get("author") as string;
    const email = formData.get("email") as string;
    const title = formData.get("title") as string;
    const body = formData.get("body") as string;
    const productId = formData.get("product_id") as string;
    const productName =
      (formData.get("product_name") as string) || "Unknown Product";
    console.log("test login.");

    console.log("Review Data:", {
      productId,
      rating,
      author,
      email,
      title,
      body,
      productName,
    });

    // Lưu đánh giá vào cơ sở dữ liệu
    console.log("test graphql");

    // 1. Lấy metafield hiện tại (nếu có)
    const existingMetafieldRes = await admin.graphql(`
    query {
      product(id: "gid://shopify/Product/${productId}") {
        reviewsField: metafield(namespace: "star", key: "reviews") {
          id
          value
        }
        ratingField: metafield(namespace: "star", key: "review") {
          id
          value
        }
      }
    }
    `);

    const responseJson = await existingMetafieldRes.json();
    console.log("Response data:", responseJson?.data);

    // Lấy reviews từ metafield star.reviews
    let existingReviews = [];
    try {
      const reviewsValue = responseJson?.data?.product?.reviewsField?.value;
      if (reviewsValue) {
        existingReviews = JSON.parse(reviewsValue);
        console.log("Đã tìm thấy", existingReviews.length, "đánh giá hiện có");
      } else {
        console.log("Chưa có metafield reviews, tạo mới");
      }
    } catch (e) {
      console.error("Lỗi khi parse dữ liệu reviews:", e);
    }

    // Lấy rating hiện tại nếu có
    let currentRating = 0;
    try {
      const ratingValue = responseJson?.data?.product?.ratingField?.value;
      if (ratingValue) {
        currentRating = parseFloat(ratingValue);
        console.log("Rating hiện tại:", currentRating);
      }
    } catch (e) {
      console.error("Lỗi khi parse rating:", e);
    }

    // 2. Thêm review mới vào mảng
    const newReview = {
      id: Date.now().toString(),
      rating,
      author,
      email,
      title,
      body,
      productName,
      createdAt: new Date().toISOString(),
    };

    // Thêm review mới vào đầu danh sách để hiển thị mới nhất trước
    const updatedReviews = [newReview, ...existingReviews];

    // Giới hạn số lượng reviews để tránh vượt quá kích thước tối đa của metafield
    const limitedReviews = updatedReviews.slice(0, 50);

    // Tính toán rating trung bình từ tất cả các đánh giá
    const totalRating = limitedReviews.reduce(
      (sum, review) => sum + review.rating,
      0,
    );
    const averageRating =
      limitedReviews.length > 0 ? totalRating / limitedReviews.length : 0;

    // 3. Lưu lại cả reviews và rating trung bình
    const response = await admin.graphql(
      `#graphql
        mutation productMetafieldSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { 
              namespace 
              key 
              value 
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          metafields: [
            {
              ownerId: `gid://shopify/Product/${productId}`,
              namespace: "star",
              key: "review",
              value: averageRating.toFixed(1),
              type: "number_decimal",
            },
            {
              ownerId: `gid://shopify/Product/${productId}`,
              namespace: "star",
              key: "count",
              value: limitedReviews.length.toString(),
              type: "number_integer",
            },
            {
              ownerId: `gid://shopify/Product/${productId}`,
              namespace: "star",
              key: "reviews",
              value: JSON.stringify(limitedReviews),
              type: "json",
            },
          ],
        },
      },
    );

    const mutationResponse = await response.json();
    console.log("response", mutationResponse);

    if (mutationResponse.data.metafieldsSet.userErrors.length > 0) {
      console.error(
        "Lỗi GraphQL:",
        mutationResponse.data.metafieldsSet.userErrors,
      );
      return json(
        {
          success: false,
          message: "Có lỗi xảy ra khi lưu đánh giá.",
          errors: mutationResponse.data.metafieldsSet.userErrors,
        },
        { status: 500 },
      );
    }

    return json({
      success: true,
      message: "Đánh giá đã được gửi thành công",
      averageRating: parseFloat(averageRating.toFixed(1)),
      reviewCount: limitedReviews.length,
    });
  } catch (error) {
    console.error("Lỗi truy vấn DB:", error);
    return json(
      {
        success: false,
        message: "Có lỗi xảy ra khi lưu đánh giá.",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
};
